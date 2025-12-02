require('dotenv').config(); // Підключення змінних середовища
const express = require('express');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Отримуємо налаштування з .env або дефолтні значення
const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 3000;
const cache = process.env.CACHE_PATH || 'public/uploads';

if (!fs.existsSync(cache)) fs.mkdirSync(cache, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, cache); 
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const app = express();
app.use(express.json()); 
app.use(express.static('public')); 
app.use(express.urlencoded({ extended: true }));

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory API',
      version: '1.0.0',
      description: 'API for managing an inventory list of items',
    },
    servers: [
      {
        url: `http://${host}:${port}`, 
      },
    ],
  },
  apis: ['./main.js'], 
};

const swaggerDocs = swaggerJSDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Тимчасове сховище в пам'яті (поки не підключимо реальний запис в MySQL)
let devices = [];
let Id = 1;

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new item
 *     description: Adds a new item to the list and uploads its photo.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - inventory_name
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: The name of the item (required).
 *               description:
 *                 type: string
 *                 description: A description of the item.
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: The photo file.
 *     responses:
 *       '201':
 *         description: Item created successfully.
 *       '400':
 *         description: The "inventory_name" field is required.
 *       '405':
 *         description: Method Not Allowed.
 */
app.post('/register', upload.single('photo'), (req, res) => {
  const { inventory_name, description } = req.body;
  const photo = req.file;

  if (!inventory_name || inventory_name.trim() === '') {
    return res.status(400).end('The "inventory_name" field is required');}
  
  const device = {
    id: Id++,
    inventory_name,
    description: description || '',
    photo: photo ? photo.path : null
  };

  devices.push(device);
  res.status(201).json(device);
});

app.all('/register', (req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Get a list of all items
 *     description: Returns an array of all inventoried items.
 *     responses:
 *       '200':
 *         description: Successful request, returns a list of items.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer, example: 1 }
 *                   inventory_name: { type: string, example: "Laptop Dell" }
 *                   description: { type: string, example: "Work laptop" }
 *                   photo_url: { type: string, example: "/inventory/1/photo" }
 *       '405':
 *         description: Method Not Allowed.
 */
app.get('/inventory', (req, res) => {
    const result = devices.map(d => ({
        ...d,
        photo_url: d.photo ? `/inventory/${d.id}/photo` : null
    }));
    res.status(200).json(result);
});

app.all('/inventory', (req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).end('Method Not Allowed');
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Get information about a specific item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The unique ID of the item.
 *     responses:
 *       '200':
 *         description: Successful request.
 *       '404':
 *         description: Item with this ID was not found.
 *   put:
 *     summary: Update the name or description of a specific item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The unique ID of the item.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Item updated successfully.
 *       '404':
 *         description: Item with this ID was not found.
 *   delete:
 *     summary: Delete an inventoried item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The unique ID of the item.
 *     responses:
 *       '200':
 *         description: Item deleted successfully.
 *       '404':
 *         description: Item with this ID was not found.
 */
app.route('/inventory/:id')
    .get((req, res) => {
        const id = Number(req.params.id);
        const device = devices.find(d => d.id === id);
        if (!device) {
            return res.status(404).end('No item with such ID');
        }
       res.status(200).json({
            ...device,
            photo_url: device.photo ? `/inventory/${device.id}/photo` : null
        });
    })
    .put((req, res) => {
        const id = Number(req.params.id);
        const { inventory_name, description } = req.body;
        const device = devices.find(d => d.id === id);
        if (!device) {
            return res.status(404).end('No item with such ID');
        }
        if (inventory_name) device.inventory_name = inventory_name;
        if (description) device.description = description;
        res.status(200).json(device);
    })
    .delete((req, res) => {
        const id = Number(req.params.id);
        const index = devices.findIndex(device => device.id === id);
        if (index === -1) {
            return res.status(404).end('Item not found');
        }
        const device = devices[index];
        if (device.photo && fs.existsSync(device.photo)) {
            fs.unlinkSync(device.photo);
        }
        devices.splice(index, 1);
        res.status(200).json({ deleted: device });
    })
    .all((req, res) => {
        res.setHeader('Allow', 'GET, PUT, DELETE');
        res.status(405).end('Method Not Allowed');
    });

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get the photo of a specific item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The unique ID of the item.
 *     responses:
 *       '200':
 *         description: Successful request, returns the image file.
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       '404':
 *         description: Item or photo not found.
 *   put:
 *     summary: Update the photo of a specific item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The unique ID of the item.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: The new photo file.
 *     responses:
 *       '200':
 *         description: Photo updated successfully.
 *       '400':
 *         description: Photo file not sent.
 *       '404':
 *         description: Item not found.
 */
app.route('/inventory/:id/photo')
    .get((req, res) => {
        const id = Number(req.params.id);
        const device = devices.find(d => d.id === id);
        if (!device) {return res.status(404).end('Item not found');}

        if (!device.photo || !fs.existsSync(device.photo)) {
            return res.status(404).end('Photo not found');}

        res.status(200);
        res.setHeader('Content-Type', 'image/jpeg'); 
        res.sendFile(path.resolve(device.photo));
    })
    .put(upload.single('photo'), (req, res) => {
        const id = Number(req.params.id);
        const device = devices.find(d => d.id === id);
        if (!device) { return res.status(404).end('Item not found');}

        if (!req.file) {return res.status(400).end('Photo file not sent');}

        if (device.photo && fs.existsSync(device.photo)) {fs.unlinkSync(device.photo); }

        device.photo = req.file.path;
        res.status(200).json(device);
    })
    .all((req, res) => {
        res.setHeader('Allow', 'GET, PUT');
        res.status(405).end('Method Not Allowed');
    });

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search for an item by ID
 *     description: Handles searching for an item by its ID, submitted via an x-www-form-urlencoded form.
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: The ID to search for.
 *               has_photo:
 *                 type: boolean
 *                 description: A flag to include a link to the photo in the response.
 *     responses:
 *       '201':
 *         description: Successful search (as per requirements).
 *       '400':
 *         description: Invalid ID.
 *       '404':
 *         description: Item not found.
 */
app.post('/search', (req, res) => {
    const { id, has_photo } = req.body;

    const numericId = Number(id);
    if (isNaN(numericId)) {
        return res.status(400).end('Invalid ID');
    }

    const device = devices.find(d => d.id === numericId);
    if (!device) {
        return res.status(404).end('Item not found');
    }

    const result = {
        id: device.id,
        inventory_name: device.inventory_name,
        description: device.description
    };

    if (device.photo) {
        result.photo_url = `/inventory/${device.id}/photo`;
    }

    res.status(201).json(result);
});

const server = http.createServer(app);
server.listen(port, host, () => { console.log(`Server is running at: http://${host}:${port}`);});