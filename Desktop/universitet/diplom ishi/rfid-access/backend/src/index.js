const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', require('./routes'));

app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.get('/login', (_, res) =>
    res.sendFile(path.join(__dirname, 'admin', 'login.html'))
);
app.get('/', (_, res) =>
    res.sendFile(path.join(__dirname, 'admin', 'index.html'))
);

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(3000, () =>
    console.log('RFID backend running on port 3000')
);
