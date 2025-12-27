const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// API
app.use('/api', require('./routes'));

// 🔥 FRONTEND (public)
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Root → index.html
app.get('/', (_, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Health
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(3000, () => {
    console.log('RFID backend running on port 3000');
});
