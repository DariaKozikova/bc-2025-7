require('dotenv').config();
const express = require('express');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const mysql = require('mysql2/promise');

const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 3000;
const cache = process.env.CACHE_PATH || 'public/uploads';

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'db', 
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection()
    .then(conn => {
        console.log('Successfully connected to MySQL database!');
        conn.release();
    })
    .catch(err => {
        console.error('Error connecting to database:', err);
    });

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
      title: 'Inventory API (MySQL)',
      version: '1.0.0',
      description: 'API for managing an inventory list of items using MySQL database',
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

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new item
 *     description: Adds a new item to the database and uploads its photo.
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
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       '201':
 *         description: Item created successfully.
 *       '400':
 *         description: Validation error.
 */
app.post('/register', upload.single('photo'), async (req, res) => {
  const { inventory_name, description } = req.body;
  const photo = req.file ? req.file.path : null;

  if (!inventory_name || inventory_name.trim() === '') {
    return res.status(400).end('The "inventory_name" field is required');
  }

  try {
    const sql = 'INSERT INTO items (inventory_name, description, photo) VALUES (?, ?, ?)';
    const [result] = await pool.query(sql, [inventory_name, description || '', photo]);
    
    const newItem = {
        id: result.insertId,
        inventory_name,
        description,
        photo_url: photo ? `/inventory/${result.insertId}/photo` : null
    };

    res.status(201).json(newItem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
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
 *     responses:
 *       '200':
 *         description: Successful request.
 */
app.get('/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM items');
        
        const result = rows.map(d => ({
            id: d.id,
            inventory_name: d.inventory_name,
            description: d.description,
            photo_url: d.photo ? `/inventory/${d.id}/photo` : null
        }));
        
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.all('/inventory', (req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).end('Method Not Allowed');
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Get item by ID
 *   put:
 *     summary: Update item
 *   delete:
 *     summary: Delete item
 */
app.route('/inventory/:id')
    .get(async (req, res) => {
        const id = Number(req.params.id);
        try {
            const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).end('No item with such ID');

            const device = rows[0];
            res.status(200).json({
                ...device,
                photo_url: device.photo ? `/inventory/${device.id}/photo` : null
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    })
    .put(async (req, res) => {
        const id = Number(req.params.id);
        const { inventory_name, description } = req.body;
        
        try {
            const [check] = await pool.query('SELECT id FROM items WHERE id = ?', [id]);
            if (check.length === 0) return res.status(404).end('No item with such ID');
            let fields = [];
            let values = [];
            if (inventory_name) { fields.push('inventory_name = ?'); values.push(inventory_name); }
            if (description) { fields.push('description = ?'); values.push(description); }
            
            if (fields.length > 0) {
                values.push(id);
                const sql = `UPDATE items SET ${fields.join(', ')} WHERE id = ?`;
                await pool.query(sql, values);
            }
            const [updated] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
            res.status(200).json(updated[0]);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    })
    .delete(async (req, res) => {
        const id = Number(req.params.id);
        try {
            const [rows] = await pool.query('SELECT photo FROM items WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).end('Item not found');

            const device = rows[0];
            await pool.query('DELETE FROM items WHERE id = ?', [id]);
            if (device.photo && fs.existsSync(device.photo)) {
                fs.unlinkSync(device.photo);
            }

            res.status(200).json({ message: `Item ${id} deleted` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    })
    .all((req, res) => {
        res.setHeader('Allow', 'GET, PUT, DELETE');
        res.status(405).end('Method Not Allowed');
    });

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get photo
 *   put:
 *     summary: Update photo
 */
app.route('/inventory/:id/photo')
    .get(async (req, res) => {
        const id = Number(req.params.id);
        try {
            const [rows] = await pool.query('SELECT photo FROM items WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).end('Item not found');

            const device = rows[0];
            if (!device.photo || !fs.existsSync(device.photo)) {
                return res.status(404).end('Photo not found');
            }

            res.status(200);
            res.setHeader('Content-Type', 'image/jpeg'); 
            res.sendFile(path.resolve(device.photo));
        } catch (err) {
            res.status(500).end();
        }
    })
    .put(upload.single('photo'), async (req, res) => {
        const id = Number(req.params.id);
        if (!req.file) return res.status(400).end('Photo file not sent');

        try {
            const [rows] = await pool.query('SELECT photo FROM items WHERE id = ?', [id]);
            if (rows.length === 0) {
                fs.unlinkSync(req.file.path);
                return res.status(404).end('Item not found');
            }

            const oldPhoto = rows[0].photo;
            await pool.query('UPDATE items SET photo = ? WHERE id = ?', [req.file.path, id]);
            if (oldPhoto && fs.existsSync(oldPhoto)) {
                fs.unlinkSync(oldPhoto);
            }

            const [updated] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
            res.status(200).json(updated[0]);

        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    })
    .all((req, res) => {
        res.setHeader('Allow', 'GET, PUT');
        res.status(405).end('Method Not Allowed');
    });

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search by ID
 */
app.post('/search', async (req, res) => {
    const { id } = req.body;
    const numericId = Number(id);

    if (isNaN(numericId)) return res.status(400).end('Invalid ID');

    try {
        const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [numericId]);
        if (rows.length === 0) return res.status(404).end('Item not found');

        const device = rows[0];
        const result = {
            id: device.id,
            inventory_name: device.inventory_name,
            description: device.description,
            photo_url: device.photo ? `/inventory/${device.id}/photo` : null
        };

        res.status(201).json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const server = http.createServer(app);
server.listen(port, host, () => { console.log(`Server is running at: http://${host}:${port}`);});