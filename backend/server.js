import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';
import pdfExtract from 'pdf-extraction';

dotenv.config();

const requiredEnv = ['GEMINI_API_KEY', 'PINECONE_API_KEY'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const indexName = process.env.PINECONE_INDEX_NAME || 'rag-index';
const embeddingModelName = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
const chatModelName = process.env.GEMINI_CHAT_MODEL || 'gemini-3.8-flash';
const embeddingDimension = 768;

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow command-line clients and health checks that do not send an Origin header.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (file.mimetype !== 'application/pdf') {
      return callback(new Error('Only PDF files are supported.'));
    }
    callback(null, true);
  },
});

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index({ name: indexName });

function chunkText(text, chunkSize = 1000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function getSessionNamespace(sessionId) {
  // The frontend creates one random UUID per browser profile to avoid mixing visitors' documents.
  if (
    typeof sessionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
  ) {
    const error = new Error('A valid sessionId is required. Refresh the page and try again.');
    error.status = 400;
    throw error;
  }
  return index.namespace(sessionId);
}

async function embedText(text) {
  const result = await genAI.models.embedContent({
    model: embeddingModelName,
    contents: text,
    config: { outputDimensionality: embeddingDimension },
  });
  const values = result.embeddings?.[0]?.values;
  if (!values || values.length !== embeddingDimension) {
    throw new Error(`Embedding model returned ${values?.length ?? 0} dimensions; expected ${embeddingDimension}.`);
  }
  return values;
}

app.get('/', (_req, res) => {
  res.json({ service: 'RAG Document Analyst API', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/upload', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PDF file.' });
    }

    const namespace = getSessionNamespace(req.body?.sessionId);
    const pdfData = await pdfExtract(req.file.buffer);
    const rawText = pdfData.text;

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({ error: 'No readable text found in this PDF. Scanned PDFs may need OCR.' });
    }

    const chunks = chunkText(rawText).map((chunk) => chunk.replace(/\x00/g, '').trim()).filter(Boolean);
    const vectors = [];

    // Sequential embedding keeps free-tier API bursts smaller; each vector matches the 768-D index.
    for (let i = 0; i < chunks.length; i += 1) {
      const values = await embedText(chunks[i]);
      vectors.push({
        id: `chunk-${Date.now()}-${i}`,
        values,
        metadata: { text: chunks[i], fileName: req.file.originalname || 'document.pdf' },
      });
    }

    if (vectors.length === 0) {
      return res.status(400).json({ error: 'No usable text chunks were found in this PDF.' });
    }

    await namespace.upsert({ records: vectors });
    return res.json({ message: `PDF processed successfully (${vectors.length} text chunks saved).` });
  } catch (error) {
    return next(error);
  }
});

app.post('/chat', async (req, res, next) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      return res.status(400).json({ error: 'Please enter a question.' });
    }

    const namespace = getSessionNamespace(req.body?.sessionId);
    const queryVector = await embedText(question);
    const searchResults = await namespace.query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    const context = (searchResults.matches || [])
      .map((match) => match.metadata?.text)
      .filter((text) => typeof text === 'string' && text.trim())
      .join('\n\n');

    if (!context) {
      return res.status(404).json({ error: 'No document context found. Upload a PDF first, then ask a question.' });
    }

    const prompt = [
      'Answer the user using only the document context below. If the context does not contain the answer, clearly say that the document does not provide enough information.',
      `Document context:\n${context}`,
      `Question: ${question}`,
    ].join('\n\n');

    const response = await genAI.models.generateContent({
      model: chatModelName,
      contents: prompt,
    });

    return res.json({ answer: response.text || 'I could not generate an answer from the retrieved context.' });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
  const message = status === 500
    ? 'The server could not process the request. Check the backend logs and API configuration.'
    : error.message;
  res.status(status).json({ error: message });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`RAG Document Analyst API listening on port ${port}`);
  console.log(`Pinecone index: ${indexName}; embedding model: ${embeddingModelName}; chat model: ${chatModelName}`);
});
