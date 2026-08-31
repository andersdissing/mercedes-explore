# Mercedes-Benz Data Explorer

A browser-based tool for Mercedes-Benz owners to fetch and inspect raw vehicle data from the Mercedes-Benz backend API. Built as a companion tool for the [Homey Mercedes app](https://github.com/andersdissing/mercedes).

## Live version

https://stmercedesexplore01.z6.web.core.windows.net/

## What it does

- Log in with your Mercedes Me credentials (OAuth2 PKCE)
- Fetch vehicle data (protobuf) from the Mercedes-Benz API
- Show the **Powertrain** the Homey app's own logic assesses the car to be - electric, petrol/diesel, or unknown - with the commands Mercedes reports for the car that produced that verdict ([issue #79](https://github.com/andersdissing/Mercedes-Benz-homey-app/issues/79))
- Display data in two tables:
  - **Capabilities** - vehicle data points mapped to Homey capabilities (values, raw keys, transforms, fallback attributes). Lock, door, window and sunroof state only travel over the Homey app's WebSocket push connection and are marked as such - the REST endpoint this tool reads never carries them
  - **Logic Flows** - Homey flow cards (actions, conditions, triggers) with their arguments, tokens and deprecation status
  - Rows and panels marked **Proposed** (currently the charge flap, [issue #55](https://github.com/andersdissing/Mercedes-Benz-homey-app/issues/55), and the powertrain assessment, [issue #79](https://github.com/andersdissing/Mercedes-Benz-homey-app/issues/79)) are requested capabilities and flow cards the Homey app does not have yet, so owners can check whether their car reports the attribute. What the Homey app needs to implement for them is tracked in [todo.md](todo.md)
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
