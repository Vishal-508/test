# Chor Police: Jugnupur ki Raat

A 3D chor-police car chase that runs in the browser. Drive a getaway car through the night town of
Jugnupur, rob shops and tijoris, vanish into hideouts while the police search for you, and hand the
loot over before the clock runs out. Play alone against computer-driven police jeeps, or with friends
using a room code.

**Play it:** https://vishal-508.github.io/test/

## How to play

- **Chor:** stop on a gold ring and the job starts by itself. Roll slowly through a green beam in one of
  the four corners to hand the loot over. Bank the target before the four minutes are up.
- A police jeep that stays close while you are slow fills the **bust meter**. Keep your speed up, or lose them.
- **Hideouts** (violet arrows on the road): pull up at the door and press the action button. The car
  swings in and the door comes down. From inside you watch the lane through the gaps. A search finds you
  if the police saw you go in, or if your engine is still warm when the officer touches the bonnet, so get
  a lead before you hide. Sit too long and an informer gives the door away. Slip out quietly, or burst out.
- Pink dashed lanes are tang galis: the getaway car fits, police jeeps do not. Sitting in one gets you reported.
- Hold the handbrake and steer to drift. Long drifts and close shaves refill nitro. Nitro is fast but loud.
- Switching the headlights off makes a creeping car harder to see.
- The three big tijoris open when the clock tower chimes (45 seconds in). Their siren starts a third of
  the way through the job. The mail coach strongbox is open only from 2:00 to 2:45.
- **Police:** stay beside a slow car to bust it. Follow alarms and tip-offs on the radar. Stop outside a
  hideout door and hold the action button to search it.
- Busted cars go to the impound. With friends, a free chor can stop at one of the two levers beside the
  thana to let everyone out. Alone, the car is released after 10 seconds, and the third bust ends the round.

| | Keyboard | Phone |
|---|---|---|
| Drive | `W` `A` `S` `D` or arrow keys | hold the left thumb down to drive, slide to steer, pull back to brake |
| Handbrake (drift) | `Space` | **DRIFT** |
| Nitro | `Shift` | **NITRO** |
| Action (hide, search) | `E` | **HIDE** / **SEARCH** |
| Leave a hideout | `E` slips out quietly, `W` bursts out | the two buttons on screen |
| Headlights | `L` | **Lights** |
| Horn | `H` | |
| Big map | `M` | tap the radar |
| Switch between street view and high view | `C` | **View** in the pause menu |
| Put the car back on the road | hold `R` | happens by itself when stuck |

Solo play is a ladder of nights: each win unlocks a harder night with more loot to bank, more jeeps and
sometimes rain. Loot you bank raises your rank and unlocks new paint for the getaway car.

## Playing with friends

1. One player presses **Create room** and gets a 4-letter code (or copies the invite link).
2. Friends press **Join room** and type the code. Up to 8 players.
3. Everyone picks a side, chor or police. The host presses **Start round**.

Computer jeeps fill in when there are few police players. The player who created the room should
keep the game tab open and in front, because their browser runs the round for everyone. (On a phone
the game keeps the screen awake while you are in a room; if the screen is locked anyway, nobody can
join until the game is back on screen.)

The host sets up the room, and everyone sees the choices:

- **Town:** Jugnupur, Hotaru-cho, or *Surprise me* for a different town each round. Everyone's game switches town without leaving the room.
- **Level 1 to 10:** higher levels bring more jeeps, faster and sharper police and a bigger target. With **Auto level-up** on, the level rises by one each time the chors win.
- **Surprises:** when on, no two rounds are the same. Each round gets
  - a kind of night: clear, rain (wet roads slide), storm, fog, a power cut (lamps, windows and signs go out), festival night (more loot, more witnesses) or full moon;
  - usually one twist, such as faster cars, slow-cooling engines, tijoris open from the start, a three-minute or five-minute round, only two hand-off points, padlocked hideouts, or extra jeeps;
  - new start points for the getaway cars, and police players starting at posts round town;
  - two small places shut and a few hideouts padlocked, different every time;
  - a **hot target** now and then: one small place pays double for 25 seconds, and both sides are told.
- **Shuffle sides** deals out chor and police at random.

The room keeps a running score across rounds (Chors 2 – 1 Police).

## Hosting on GitHub Pages

The game is plain files with no build step, so GitHub Pages serves it as it is. The live copy is the
`gh-pages` branch of this repository (**Settings → Pages → Deploy from a branch → gh-pages, / (root)**).

To try it on your own computer, serve the folder with any static server (for example
`python3 -m http.server`) and open the address it prints. Opening `index.html` straight from disk does not
work, because browsers block module scripts on `file://`.

## How multiplayer works without a server

GitHub Pages only serves files, so there is no game server. Friends connect browser to browser
(WebRTC data channels, through the [PeerJS](https://peerjs.com) library). The free public PeerJS broker
introduces the browsers to each other when a room is created or joined.

Two devices cannot always open a direct link, and the most common case is two devices on the same home
Wi-Fi (the router will not pass traffic between them). So joining has a **backup route**: if the direct
link has not opened after five seconds, the same game messages travel through a free public message relay
instead (MQTT over a secure WebSocket; three public test brokers are tried at once and the first to reach
the host is used). It is a little slower, so it is only used when needed, and a player who came in that
way is tagged "backup route" in the room. If the PeerJS broker itself cannot be reached, the room still
works on the backup route alone. These relays are public test services with no sign-up and no promise of
uptime; the game moves to another one if the one in use goes quiet.

For testing, add `&link=relay` to the address on the joining device to skip the direct link, or
`&link=direct` to never use the backup route.

## What is in this folder

| Path | What it is |
|---|---|
| `index.html` | the page, menus and on-screen controls |
| `js/game.js` | rules, police driving, multiplayer sync, input, camera and the main loop |
| `js/config.js` | every tunable number: round length, speeds, bust meter, hideout timings, the solo night ladder, and the room levels, kinds of night and twists |
| `js/vehicle.js` | car handling (drift, nitro, crashes) and the computer driver |
| `js/world.js` | turns the map into roads, buildings, hideout bays, sight lines and routes |
| `js/scene.js`, `js/dressing.js` | the 3D town: ground, buildings, lamps, neon signs, rooftops |
| `js/ambient.js` | what moves and glows in a town that asks for it: night sky, railway and train, video screens, vertical signs, traffic lights, blossom |
| `js/cars.js`, `js/hideouts.js` | the car models and the nine kinds of hideout |
| `js/fx.js`, `js/postfx.js` | smoke, sparks, skid marks, rain; bloom and colour grade |
| `js/audio.js` | engine, sirens, music and effects, all synthesised (no sound files) |
| `js/net.js` | room codes and browser-to-browser connections |
| `js/relay.js` | the backup route for devices that cannot link directly: a small MQTT client and the hand-over rules on top of it |
| `data/map.json` | the town of Jugnupur: roads, places to rob, hiding spots, hand-off points |
| `data/map-hotaru.json` | a second town, Hotaru-cho (Japan). Pick it with the **Town** button on the menu or in a room |
| `vendor/` | [three.js](https://threejs.org) r160 (with its post-processing add-ons) and [PeerJS](https://peerjs.com) 1.5.4, both MIT licensed |
| `tools/check-world.mjs` | `node tools/check-world.mjs` checks every place on the map can be driven to (`node tools/check-world.mjs hotaru` for the second town) |
| `tools/stamp.mjs` | `node tools/stamp.mjs 3` after changing the game's code, so browsers fetch the new files together |
| `tools/preview-*.html` | stand-alone viewers for the cars, hideouts, effects, sounds and signs |

## Not built

- The town is flat: no ramps, bridges or rooftop driving.
- The computer only drives police jeeps. A solo player is always the chor.
- There is no traffic and nobody walks the streets.

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