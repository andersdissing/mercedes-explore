# Overall goal
Create a website where a Mercedes-Benz owner can fetch data from their backend API about their car shows.

# User flow
1. The user goes to the website. 
2. The user clicks the login box.
2.1. This will prompt the user to enter the username and password to gain access to the Mercedes-Benz backend api
3. Now with credentials, the website calls the Mercedes-Benz backend api, while the app is fetching data, a loading animation is displayed to inform the user that the app is loading
4. After the app has fetched data, the data needs to be displayed. This is done in a table format, and see requirements about the data point in the headline "Data points"

# Data points
Overall, there should be two tables. 
Both tables have the same columns
1. capability name or logic flow name
2. value as shown in the Homey app
3. name of the raw data value
4. The value of the raw data value

- Table 1 should only show the capability, and the other columns
- Table 2 should only show the logic flow value and the other columns
- For both tables, a headline and a descriptive text need to be added to tell what the user is seeing
- An export, copy to clipboard button needs to be added. This button is only for the table 1. The data should be in a table, then pasted back again.

! Important that there are two tables, one for capability and one for logic flow value

Source for capability or logic flow can be found there, C:\code\homey\mercedes

# Export function
There are two copy-to-clipboard buttons for the capabilities table:
1. **Copy Table** — copies the capabilities data as a tab-separated table (Capability Name, Homey Value, Raw Data Key, Raw Value) that pastes into Excel/Sheets.
2. **Copy Raw Data** — copies the raw key/value pairs in a simple `key = value` format, one per line.


# Source for login code and how to fetch api can be found in this Homey app:
C:\code\homey\mercedes

# Progress log
At the bottom of the app, a log of all the progress of what the app is doing, like logging in, logged in, fetching data, data fetched, etc., should be displayed.

# Tech stack
- Static website hosted on Azure Storage Account (free static hosting)
- CORS proxy on Azure Functions (Consumption plan — essentially free for light usage)
- A proxy is required because Mercedes API blocks browser requests directly
- Local development uses server.js (Node.js) which serves both static files and the proxy
- I need a PowerShell/Bicep script that:
  - Deploys a Storage Account + Function App (Consumption) via Bicep
  - Enables static website hosting on the Storage Account
  - Deploys the Function App code (zip deploy with npm install)
  - Generates config.js pointing the frontend to the Function App URL
  - Uploads static files to the $web container
  - Outputs the website URL
