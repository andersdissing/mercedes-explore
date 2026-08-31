# Mercedes-Benz Data Explorer

A browser-based tool for Mercedes-Benz owners to fetch and inspect raw vehicle data from the Mercedes-Benz backend API. Built as a companion tool for the [Homey Mercedes app](https://github.com/andersdissing/mercedes).

## Live version

https://stmercedesexplore01.z6.web.core.windows.net/

## What it does

- Log in with your Mercedes Me credentials (OAuth2 PKCE)
- Fetch vehicle data (protobuf) from the Mercedes-Benz API
- Display data in two tables:
  - **Capabilities** - vehicle data points mapped to Homey capabilities (values, raw keys, transforms, fallback attributes). Lock, door, window and sunroof state only travel over the Homey app's WebSocket push connection and are marked as such - the REST endpoint this tool reads never carries them
  - **Logic Flows** - Homey flow cards (actions, conditions, triggers) with their arguments, tokens and deprecation status
  - Rows marked **Proposed** (currently the charge flap, [issue #55](https://github.com/andersdissing/Mercedes-Benz-homey-app/issues/55)) are requested capabilities and flow cards the Homey app does not have yet, so owners can check whether their car reports the attribute. What the Homey app needs to implement for them is tracked in [todo.md](todo.md)
- Copy capabilities table or raw key/value data to clipboard
- Refresh data without re-logging in
- Progress log showing each step of the login and data fetch process

## Local development

```bash
npm install
npm start
```

Open http://localhost:3000

## Deployment

Hosted on Azure: Storage Account (static site) + Function App (Consumption plan, CORS proxy).

```powershell
.\deploy\deploy.ps1 -ResourceGroupName "rg-mercedes-explore" -StorageAccountName "stmercedesexplore01" -FunctionAppName "func-mercedes-explore"
```

The deploy script handles everything: resource provisioning (Bicep), function deployment, static file upload.

The same script also runs from GitHub: the **Deploy to Azure** workflow (Actions tab, manual trigger) deploys whichever branch it is dispatched from. It needs a one-time `AZURE_CREDENTIALS` repository secret; the setup command is in [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
