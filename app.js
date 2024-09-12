const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const mime = require('mime-types');

const app = express();
const upload = multer({ dest: 'uploads/' });
const port = 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const client = new Client({
    authStrategy: new LocalAuth()
});

let qrCodeData = '';
let isAuthenticated = false;

client.on('qr', (qr) => {
    qrCodeData = qr;
    qrcode.generate(qr, { small: true });
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Client is ready!');
    isAuthenticated = true;
    qrCodeData = '';
});

client.initialize();

app.get('/auth-status', (req, res) => {
    res.json({ isAuthenticated, qr: qrCodeData });
});

app.post('/upload-file', upload.single('file'), (req, res) => {
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        processData(data, res);
    } else if (fileExtension === '.csv') {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                processData(results, res);
            });
    } else {
        res.status(400).json({ error: 'Unsupported file format' });
    }
});

function processData(data, res) {
    const results = data.map(row => ({
        name: row.Name || '',
        number: String(row.Number || '').replace(/[^\d]/g, '')
    }));
    res.json(results);
}

app.post('/send-messages', upload.single('image'), async (req, res) => {
    const { contacts, message, includeName } = JSON.parse(req.body.data);
    const results = [];

    for (const contact of contacts) {
        try {
            const chatId = `${contact.number}@c.us`;
            let personalizedMessage = message;
            
            if (includeName) {
                personalizedMessage = personalizedMessage.replace(/{name}/g, contact.name);
            }

            if (req.file) {
                const filePath = req.file.path;
                const mimeType = mime.lookup(req.file.originalname);
                const data = fs.readFileSync(filePath, {encoding: 'base64'});
                const media = new MessageMedia(mimeType, data, req.file.originalname);
                await client.sendMessage(chatId, media, { caption: personalizedMessage });
            } else {
                await client.sendMessage(chatId, personalizedMessage);
            }

            results.push({ number: contact.number, name: contact.name, status: 'success' });
        } catch (error) {
            console.error(`Error sending message to ${contact.number}:`, error);
            results.push({ number: contact.number, name: contact.name, status: 'failed', error: error.message });
        }
    }

    if (req.file) {
        fs.unlinkSync(req.file.path);
    }

    res.json(results);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});