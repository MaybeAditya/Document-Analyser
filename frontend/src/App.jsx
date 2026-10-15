import { useEffect, useRef, useState } from 'react';
import './App.css';

// Keep localhost for local development only. Production has a safe backend fallback.
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const defaultApiBaseUrl = import.meta.env.DEV
  ? 'http://localhost:3000'
  : 'https://rag-document-analyst-api.onrender.com';
const API_BASE_URL = (configuredApiBaseUrl || defaultApiBaseUrl).replace(/\/+$/, '');
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function getSessionId() {
  let sessionId = window.localStorage.getItem('rag-document-analyst-session');
  if (!sessionId) {
    sessionId = window.crypto.randomUUID();
    window.localStorage.setItem('rag-document-analyst-session', sessionId);
  }
  return sessionId;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [file, setFile] = useState(null);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [delayMessage, setDelayMessage] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null);
  const [hasUploadedDocument, setHasUploadedDocument] = useState(false);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatHistory, isAsking, delayMessage]);

  const acceptFile = (candidate) => {
    if (!candidate) return;
    const looksLikePdf = candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      setUploadStatus({ kind: 'error', message: 'Choose a PDF file to continue.' });
      return;
    }
    if (candidate.size > MAX_FILE_SIZE) {
      setUploadStatus({ kind: 'error', message: 'This file is over 15 MB. Choose a smaller PDF.' });
      return;
    }
    setFile(candidate);
    setUploadStatus(null);
  };

  const handleFileInput = (event) => {
    acceptFile(event.target.files?.[0]);
    // Let a user re-select the same file after an upload failure.
    event.target.value = '';
  };

  const handleUpload = async () => {
    if (!file) {
      setUploadStatus({ kind: 'error', message: 'Choose a PDF before indexing it.' });
      return;
    }

    setIsUploading(true);
    setUploadStatus({ kind: 'working', message: 'Extracting text and creating embeddings…' });
    const formData = new FormData();
    formData.append('document', file);
    formData.append('sessionId', getSessionId());

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `The server returned HTTP ${response.status}.`);
      }

      setHasUploadedDocument(true);
      setUploadStatus({ kind: 'success', message: data.message || 'Your PDF is indexed and ready for questions.' });
    } catch (error) {
      console.error('Document upload failed:', error);
      setUploadStatus({
        kind: 'error',
        message: error instanceof Error
          ? error.message.includes('Failed to fetch')
            ? `Could not reach the API at ${API_BASE_URL}. Check the Render service and its FRONTEND_URL setting.`
            : error.message
          : 'The upload failed. Check the backend logs and try again.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAskQuestion = async (event) => {
    event?.preventDefault();
    const currentQuestion = question.trim();
    if (!currentQuestion || isAsking) return;

    const nextHistory = [...chatHistory, { role: 'user', text: currentQuestion }];
    setChatHistory(nextHistory);
    setQuestion('');
    setIsAsking(true);
    setDelayMessage('');

    const timeoutId = window.setTimeout(() => {
      setDelayMessage('Still working. The first request can take longer while the service wakes up.');
    }, 7000);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: currentQuestion, sessionId: getSessionId() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `The server returned HTTP ${response.status}.`);
      }
      setChatHistory([...nextHistory, { role: 'ai', text: data.answer || 'No answer was returned.' }]);
    } catch (error) {
      console.error('Chat request failed:', error);
      const message = error instanceof Error && error.message.includes('Failed to fetch')
        ? `Could not reach the API at ${API_BASE_URL}. Check that the Render service is live and allows this Vercel origin.`
        : error instanceof Error ? error.message : 'The request failed. Try again in a moment.';
      setChatHistory([...nextHistory, { role: 'ai', text: message, isError: true }]);
    } finally {
      window.clearTimeout(timeoutId);
      setIsAsking(false);
      setDelayMessage('');
    }
  };

  const suggestedQuestions = [
    'Summarize the main points',
    'What are the key dates?',
    'What should I pay attention to?',
  ];

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Document Analyst home">
          <span className="brand-mark" aria-hidden="true">D.</span>
          <span className="brand-name">Document Analyst</span>
        </a>
        <div className="topbar-meta">
          <span className="status-dot" aria-hidden="true" />
          <span>PDF WORKSPACE</span>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="eyebrow"><span>DOCUMENT INTELLIGENCE</span><span className="eyebrow-rule" /></div>
          <div className="hero-copy-grid">
            <h1>Read less.<br /><em>Understand more.</em></h1>
            <div className="hero-description">
              <p>Ask thoughtful questions of long PDFs. Get answers based on passages retrieved from your document, with the original text doing the heavy lifting.</p>
              <div className="hero-detail"><span>01</span> Upload a PDF <span className="detail-separator">/</span> <span>02</span> Ask a question <span className="detail-separator">/</span> <span>03</span> Explore the answer</div>
            </div>
          </div>
        </section>

        <section className="workspace" aria-label="Document question answering workspace">
          <aside className="source-panel panel">
            <div className="panel-heading">
              <div>
                <p className="panel-index">01 / SOURCE</p>
                <h2>Your document</h2>
              </div>
              <span className="panel-glyph" aria-hidden="true">↳</span>
            </div>
            <p className="panel-intro">Start with a text-based PDF. The contents will be indexed so you can search them by meaning.</p>

            <button
              type="button"
              className={`dropzone${isDragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                acceptFile(event.dataTransfer.files?.[0]);
              }}
              aria-label="Choose or drop a PDF file"
            >
              <span className="pdf-icon" aria-hidden="true">PDF</span>
              {file ? (
                <>
                  <span className="dropzone-title file-name">{file.name}</span>
                  <span className="dropzone-caption">{formatFileSize(file.size)} · Ready to index</span>
                </>
              ) : (
                <>
                  <span className="dropzone-title">Drop your PDF here</span>
                  <span className="dropzone-caption">or click to browse files</span>
                </>
              )}
              <span className="dropzone-limit">PDF ONLY · UP TO 15 MB</span>
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileInput}
              aria-label="Choose PDF file"
            />

            <button className="button button-primary upload-button" type="button" onClick={handleUpload} disabled={isUploading || !file}>
              <span>{isUploading ? 'Indexing document…' : 'Index document'}</span>
              <span aria-hidden="true">{isUploading ? '···' : '↗'}</span>
            </button>

            {uploadStatus && (
              <div className={`inline-status status-${uploadStatus.kind}`} role="status" aria-live="polite">
                {uploadStatus.kind === 'success' && <span className="status-symbol" aria-hidden="true">✓</span>}
                {uploadStatus.kind === 'error' && <span className="status-symbol" aria-hidden="true">!</span>}
                <span>{uploadStatus.message}</span>
              </div>
            )}

            <div className="source-footnote">
              <span className="footnote-mark" aria-hidden="true">i</span>
              <p>Scanned PDFs may not work without OCR. Avoid uploading sensitive documents to this public demo.</p>
            </div>
          </aside>

          <section className="chat-panel panel" aria-labelledby="conversation-heading">
            <div className="panel-heading chat-heading">
              <div>
                <p className="panel-index">02 / CONVERSATION</p>
                <h2 id="conversation-heading">Ask your document</h2>
              </div>
              <span className={`ready-label${hasUploadedDocument ? ' ready-label-active' : ''}`}>
                <span className="status-dot" aria-hidden="true" />
                {hasUploadedDocument ? 'DOCUMENT INDEXED' : 'READY WHEN YOU ARE'}
              </span>
            </div>

            <div className={`chat-window${chatHistory.length === 0 ? ' chat-window-empty' : ''}`} aria-live="polite">
              {chatHistory.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-chat-mark" aria-hidden="true">“ ”</div>
                  <h3>What would you like to know?</h3>
                  <p>Upload and index a PDF, then ask a question in your own words. Answers are generated from the most relevant passages found in the document.</p>
                  <div className="suggested-prompts" aria-label="Suggested questions">
                    {suggestedQuestions.map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)}>{suggestion}<span aria-hidden="true">↗</span></button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="message-list">
                  {chatHistory.map((message, index) => (
                    <article key={`${index}-${message.role}`} className={`message message-${message.role}${message.isError ? ' message-error' : ''}`}>
                      <div className="message-label">{message.role === 'user' ? 'YOU' : message.isError ? 'NOTICE' : 'DOCUMENT ANALYST'}</div>
                      <p>{message.text}</p>
                    </article>
                  ))}
                  {isAsking && (
                    <article className="message message-ai message-pending">
                      <div className="message-label">DOCUMENT ANALYST</div>
                      <p className="typing-label"><span className="typing-dots" aria-hidden="true">•••</span> Retrieving relevant passages…</p>
                    </article>
                  )}
                  {delayMessage && <p className="delay-note">{delayMessage}</p>}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            <form className="question-form" onSubmit={handleAskQuestion}>
              <label className="visually-hidden" htmlFor="question-input">Ask a question about your document</label>
              <input
                id="question-input"
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question about your PDF…"
                autoComplete="off"
                disabled={isAsking}
              />
              <button className="send-button" type="submit" disabled={isAsking || !question.trim()} aria-label="Send question">
                <span>{isAsking ? 'Working' : 'Ask'}</span><span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className="chat-disclaimer">Answers can be incomplete or incorrect. Verify important details in the original document.</p>
          </section>
        </section>

        <section className="how-section" aria-labelledby="how-heading">
          <div className="section-topline">
            <p className="panel-index">A SMALL LOOK UNDER THE HOOD</p>
            <span className="section-rule" />
          </div>
          <div className="how-heading-row">
            <h2 id="how-heading">How it works</h2>
            <p>Retrieval-Augmented Generation (RAG) grounds each answer in text retrieved from your PDF.</p>
          </div>
          <div className="process-grid">
            <article className="process-step">
              <span className="step-number">01</span>
              <h3>Extract & split</h3>
              <p>The Express API extracts text from the PDF and divides it into smaller chunks for retrieval.</p>
              <span className="step-tech">PDF EXTRACTION</span>
            </article>
            <article className="process-step">
              <span className="step-number">02</span>
              <h3>Embed & retrieve</h3>
              <p>Gemini converts chunks and questions into vectors. Pinecone finds the three closest matching chunks.</p>
              <span className="step-tech">GEMINI EMBEDDINGS · PINECONE</span>
            </article>
            <article className="process-step">
              <span className="step-number">03</span>
              <h3>Generate an answer</h3>
              <p>The retrieved passages and your question are sent to Gemini to generate a context-aware response.</p>
              <span className="step-tech">RETRIEVAL-AUGMENTED GENERATION</span>
            </article>
          </div>
          <div className="architecture-note">
            <span className="architecture-label">STACK</span>
            <p>React · Vite · Node.js · Express · Google Gemini · Pinecone</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>DOCUMENT ANALYST <span className="footer-separator">/</span> BUILT TO MAKE LONG PDFs EASIER TO NAVIGATE</span>
        <a href="https://github.com/MaybeAditya/Document_Analyser" target="_blank" rel="noreferrer">SOURCE CODE ↗</a>
      </footer>
    </div>
  );
}

export default App;
