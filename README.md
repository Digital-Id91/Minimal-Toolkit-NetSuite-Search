# Minimal Toolkit + NetSuite Search

## Privacy Policy
Minimal Toolkit + NetSuite Search does not collect, transmit, distribute, or sell any personal data. All user preferences, notes, screenshots, and clipboard snippets are stored securely and locally on the user's device.

## Technical Overview
A consolidated Chrome extension designed to streamline administrative and operational workflows. 

### Core Mechanics
* **Environment Overlays:** Injects customizable DOM elements to visually identify active instances based on URL matching.
* **Contextual NetSuite Querying:** Enables highlight-to-search functionality against a user-configured NetSuite Account ID via the context menu. Routes parameterized text queries directly to `ubersearchresults.nl`.
* **Screenshot Capture & Canvas Annotation:** Captures the active viewport or designated coordinate matrices. Routes captures to an HTML5 Canvas annotation editor equipped with vector tools, text generation, and local gallery caching. Executes automated blob writes to `navigator.clipboard`.
* **Persistent Text Editor:** A `chrome.storage.local`-backed note application featuring dynamic line numbering, adjustable typography metrics, and direct export to `text/plain` blobs.
* **Clipboard Operations & Input Dispatching:** Intercepts `copy` events to execute a `.trim()` method, stripping leading and trailing whitespace. Stores predefined string configurations locally and injects them into active DOM inputs using synthetic `input` and `change` event dispatching.