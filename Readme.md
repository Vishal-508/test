# Chor Police: Jugnupur ki Raat

A 3D chor-police game that runs in the browser. Rob the night town of Jugnupur, hide from the police,
and carry the loot out before time runs out. Play alone against computer constables, or with friends
using a room code.

**Play it:** https://vishal-508.github.io/test/ (works once GitHub Pages is switched on, see below)

## How to play

- **Chor:** rob the glowing gold boxes, then carry the loot to a green beam in one of the four corners.
  Bank the target amount before the six minutes are up.
- Hide in the violet circles. Police cannot see you there unless they search that exact spot.
- Running is fast but noisy, and someone tips off the police now and then while you carry a bag through lit streets.
  The dark park is safe from tip-offs.
- The three big tijoris (jeweller, bank, market strongroom) open when the clock tower chimes at 1:00.
  The mail coach at the station is open only from 3:00 to 4:00.
- Pink dashed trails are shortcuts the computer police will not follow. Crawl pipes are for chors only.
- **Police:** touch a chor to arrest. Follow alarms and tip-offs on your map, and search hiding spots.
- Caught chors go to the lock-up. With friends, a free chor can pull one of the two levers beside the
  thana to free everyone inside. Alone, you are bailed out after 15 seconds, and the third arrest ends the round.

| | Keyboard and mouse | Phone |
|---|---|---|
| Move | `WASD` or arrow keys | left thumb (stick appears where you touch) |
| Action (rob, bank, hide, lever, search) | hold `Space` | hold **ACT** |
| Run | hold `Shift` | hold **RUN** |
| Turn the camera | drag, or `Q` / `E` | drag with the right thumb |
| Big map | `M` | tap the small map |

Solo play is a ladder of nights: each win unlocks a harder night with more loot to bank and sharper police.

## Playing with friends

1. One player presses **Create room** and gets a 4-letter code (or copies the invite link).
2. Friends press **Join room** and type the code. Up to 8 players.
3. Everyone picks a side, chor or police. The host presses **Start round**.

Computer constables fill in when there are few police players. The player who created the room should
keep the game tab open and in front, because their browser runs the round for everyone.

## Hosting on GitHub Pages

The game is plain files with no build step, so GitHub Pages can serve it as it is.

1. On GitHub open this repository, then **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the branch that holds these files
   and the `/ (root)` folder, then **Save**.
3. After a minute or two the game is live at `https://vishal-508.github.io/test/`.

To try it on your own computer, serve the folder with any static server (for example
`python3 -m http.server`) and open the address it prints. Opening `index.html` straight from disk does not
work, because browsers block module scripts on `file://`.

## How multiplayer works without a server

GitHub Pages only serves files, so there is no game server. Friends connect browser to browser
(WebRTC data channels, through the [PeerJS](https://peerjs.com) library). The only outside service is the
free public PeerJS broker, which introduces the browsers to each other when a room is created or joined.
On some mobile networks and office firewalls a direct connection cannot be made; if joining fails, try
another network or Wi-Fi.

## What is in this folder

| Path | What it is |
|---|---|
| `index.html` | the page, menus and on-screen controls |
| `js/game.js` | rules, police AI, multiplayer sync, input and the main loop |
| `js/world.js` | turns the map into walkable ground, buildings, sight lines and paths |
| `js/scene.js`, `js/entities.js` | the 3D town and the characters |
| `js/net.js`, `js/audio.js`, `js/config.js` | room codes and connections, synthesised sound, tunable numbers |
| `data/map.json` | the town of Jugnupur: roads, places to rob, hiding spots, ways out |
| `vendor/` | [three.js](https://threejs.org) r160 and [PeerJS](https://peerjs.com) 1.5.4, both MIT licensed |
| `tools/check-world.mjs` | `node tools/check-world.mjs` checks the map is fully connected after an edit |

## Not in this first version

- Everyone is on foot. The police jeep from the map plan is not built.
- Rooftop runs and the dry drain are flat passages, not raised or sunken levels.
- Each tijori has one door. The quiet back way from the map plan is not built.
- The computer only plays police. A solo player is always the chor.

---

## Earlier notes in this repository

Q. DIFFERENCE BETWEEN PROPS AND STATE?

PROPS: 1)The Data is passed from one component to another.
 2)It is Immutable (cannot be modified).
  3)Props can be used with state and functional components.. 
  4)Props are read-only..

STATE: 1)The Data is passed within the component only. 
2)It is Mutable ( State is both read and write. can be modified). 
3)State can be used only with the state components/class component. 
4) State is both read and write.

Q. Explain The useState API?

-> The useState hook allows you to use local state in your React code. The useState API expects you to provide a variable name for the state you want to use and a setter function to set the state variable you declare.

Q. Explain the how map, filter, reduce work-

-> MAP: MAP is a method built to do exactly that. It's defined on Array.prototype, so you can call it on any array, and it accepts a callback as its first argument.

-> FILTER: It takes an array and filters out unwanted elements.

#. The syntax for filter is:
let newArray = arr.filter(callback(currentValue[ index ,[ array]]) { // return element for newArray, if true }[thisArg]);

-> REDUCE:
#. The syntax for the reduce array method in JavaScript is:
let newArray = arr.filter(callback(currentValue, accumulatedValue) { // return the accumulated value, given the current and previous accumulated value }, //initialValue [thisArg]);