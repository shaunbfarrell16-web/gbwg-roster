# The Great British Warcraft Guild – Roster Tracker

Shared guild dashboard: members add their character (class, spec, role, race, professions)
and it saves for everyone via Netlify Blobs.

## Deploy (pick one)

IMPORTANT: Netlify's drag-and-drop deploy does NOT run the save function. Use one of these:

### Option A – GitHub (easiest long-term)
1. Create a new GitHub repo and upload everything in this folder.
2. Netlify > Add new site > Import an existing project > pick the repo.
3. Leave build settings as they are (netlify.toml handles it) and deploy.

### Option B – Netlify CLI
    npm install
    npx netlify-cli login
    npx netlify-cli deploy --prod

## Officer PIN (optional)
Site configuration > Environment variables > add ADMIN_PIN = your choice of PIN, then redeploy.
Officers click "Officer login" to edit or remove anyone's character.

## How editing works
Each member can edit/remove the characters they added from the same browser.
Anything else (new phone, cleared cookies) needs an officer.
