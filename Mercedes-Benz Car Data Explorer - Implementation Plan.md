Context
Build a browser-based website where a Mercedes-Benz owner can log in, fetch vehicle data from the Mercedes API, and view it in two tables (capabilities and logic flows). All logic runs client-side. Hosted on Azure Storage Account with a PowerShell/Bicep deployment script. Reference implementation exists at C:\code\homey\mercedes.
File Structure
C:\code\homey\mercedes-explore\
  project.md              (exists)
  index.html              -- Single page app
  css/
    style.css             -- Styling
  js/
    app.js                -- Main orchestrator, progress log, UI wiring
    auth.js               -- OAuth2 PKCE login (ported from lib/oauth.js)
    api.js                -- Vehicle data fetching (ported from lib/api.js)
    proto.js              -- Protobuf parsing in browser
    tables.js             -- Table rendering + clipboard export
    data.js               -- Hardcoded capability & flow mappings
  proto/
    vehicle-events.proto  -- Copied from existing app
  deploy/
    deploy.ps1            -- PowerShell deployment script
    main.bicep            -- Bicep template for Azure Storage Account
Implementation Steps
Step 1: HTML + CSS scaffold

index.html: login form (region dropdown, email, password), loading spinner, two table sections with headings/descriptions, shared "Copy to Clipboard" button, progress log div at bottom
css/style.css: clean professional styling, responsive layout
Load protobufjs from CDN

Step 2: Auth module (js/auth.js)
Port C:\code\homey\mercedes\lib\oauth.js to browser:

Replace crypto.randomBytes → crypto.getRandomValues
Replace crypto.createHash('sha256') → crypto.subtle.digest('SHA-256')
Replace axios + tough-cookie → fetch with credentials: 'include'
Same 6-step OAuth2 PKCE flow: getAuthorizationResume → sendUserAgentInfo → submitUsername → submitPassword → (legalConsent) → resumeAuthorization → exchangeCodeForTokens
Region-specific endpoints (Europe, NA, APAC, China)
Store tokens in sessionStorage

Step 3: API module (js/api.js)
Port C:\code\homey\mercedes\lib\api.js to browser:

getVehicles() — GET /v2/vehicles from BFF endpoint
getVehicleData(vin) — GET widget endpoint /v1/vehicle/{vin}/vehicleattributes (arraybuffer response)
Same headers: spoofed iOS user agent, app version, session/tracking IDs
Replace axios → fetch

Step 4: Protobuf parser (js/proto.js)

Copy C:\code\homey\mercedes\lib\proto\vehicle-events.proto to proto/
Use protobufjs (CDN) to load the .proto and decode VEPUpdate messages
Port attribute extraction logic from C:\code\homey\mercedes\lib\proto\parser.js

Step 5: Data mappings (js/data.js)

Hardcode capability mappings from device.js lines 614-911: raw key → capability name, title, transform
Hardcode flow card data from .homeycompose/flow/ (22 actions, 11 conditions, 18 triggers): name, type, description, related capabilities

Step 6: Table rendering + export (js/tables.js)

Table 1 — Capabilities: capability name | Homey value | raw data key | raw value
Table 2 — Logic Flows: flow name | type (action/condition/trigger) | description | related data
Shared "Copy to Clipboard" button: formats both tables as TSV via navigator.clipboard.writeText()

Step 7: Main app (js/app.js)

Wire login button → auth.login() → api.getVehicles() → vehicle selector → api.getVehicleData() → parse → render tables
Progress log: timestamped entries appended to log div (logging in, logged in, fetching vehicles, fetching data, done, errors)
Error handling with user-friendly messages

Step 8: Azure deployment scripts

deploy/main.bicep: Storage Account (Standard_LRS, StorageV2) with static website enabled
deploy/deploy.ps1: create resource group, deploy Bicep, upload files to $web container, output website URL

Key Reference Files

C:\code\homey\mercedes\lib\oauth.js — OAuth2 PKCE flow (all 6 steps)
C:\code\homey\mercedes\lib\api.js — API endpoints, headers, request patterns
C:\code\homey\mercedes\drivers\mercedes-vehicle\device.js (lines 614-911) — raw data → capability mapping
C:\code\homey\mercedes\lib\proto\vehicle-events.proto — protobuf schema (copy verbatim)
C:\code\homey\mercedes\lib\proto\parser.js — protobuf decode logic
C:\code\homey\mercedes\.homeycompose\flow/ — flow card JSON definitions
C:\code\homey\mercedes\.homeycompose\capabilities/ — capability JSON definitions

Verification

Open index.html locally in browser
Enter Mercedes credentials and select region
Verify progress log shows login steps
Verify both tables populate with vehicle data
Test "Copy to Clipboard" — paste into Excel/Sheets and confirm table format
Run deploy/deploy.ps1 against an Azure subscription and verify the site loads from the Storage Account URL