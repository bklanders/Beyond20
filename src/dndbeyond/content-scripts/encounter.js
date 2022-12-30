console.log("Beyond20: D&D Beyond Encounter module loaded.");

var settings = getDefaultSettings();
var last_monster_name = null;
var last_combat = null;
var character = null;
var led_serial_started = false;
var led_port;
var led_writer;
var highlighted_seat;

// BEGIN Beyond LED Functions
async function setupBeyondLED() {
    console.log("BeyondLED Setup Started.");
    const device_filters = [
        { usbVendorId: 0x2341, usbProductId: 0x0042 } //Arduino Mega
    ];
    led_port = await navigator.serial.requestPort({ device_filters });
    var port_response = await led_port.open({ baudRate: 9600 }); //open serial port to the device.
    const textEncoder = new TextEncoderStream();
    const writableStreamClosed = textEncoder.readable.pipeTo(led_port.writable);
    led_writer = textEncoder.writable.getWriter();
    led_serial_started = true;
    console.log("BeyondLED Setup Complete.");
}

async function updateBeyondLED(partyStatusString) {
    // Expects "<ACTIVE_PLAYER (int), bloodied (bool), bloodied (bool), bloodied (bool)...>" to send to LED device
    await led_writer.write(partyStatusString);
}

function sendCombatUpdateToBeyondLED(combat) {
    var highlight_seat;
    var character_seating = settings['beyond-led-seating'].split(',').map(name => name.trim());
    var active_combatant = combat.filter(combatant => (combatant.turn))[0];
    var player_characters = combat.filter(combatant => (combatant.tags.includes("character")));
    var player_status_array= [];

    if (active_combatant.tags.includes("character")) {
        highlight_seat = character_seating.indexOf(active_combatant.name) + 1; //DM is 0
    }
    else {
        highlight_seat = 0; //DM Seat
    }
    if (highlight_seat !== highlighted_seat) {
        //Get player statuses (whether they are bloodied or critical) in seating order.
        character_seating.forEach(character_name => {
            var pc = player_characters.filter(pc => pc.name == character_name)[0];
            if (pc.tags.indexOf("is-bloodied") != -1 || pc.tags.indexOf("is-critical") != -1) { //If the PC is bloodied or critical
                player_status_array.push(1);
            }
            else {
                player_status_array.push(0);
            }            
        });
        highlighted_seat = highlight_seat;
        updateBeyondLED("<" + highlight_seat + ", " + player_status_array.toString() + ">");
    }
    console.log(active_combatant.name + "'s Turn");    
    console.log("Highlighting Player Seat: " + highlight_seat);
}
// END Beyond LED Functions

function documentModified(mutations, observer) {

    if (isExtensionDisconnected()) {
        console.log("This extension is DOWN!");
        observer.disconnect();
        return;
    }

    const monster = $(".encounter-details-monster-summary-info-panel,.encounter-details__content-section--monster-stat-block,.combat-tracker-page__content-section--monster-stat-block,.monster-details-modal__body");
    const monster_name = monster.find(".mon-stat-block__name").text();
    if (settings["sync-combat-tracker"]) {
        updateCombatTracker();
    }
    //console.log("Doc modified, new mon : ", monster_name, " !=? ", last_monster_name);
    if (monster_name !== last_monster_name) {
        last_monster_name = monster_name;
        removeRollButtons();
        character = new Monster("Monster", null, settings);
        character.parseStatBlock(monster);
    }
    const customRoll = DigitalDiceManager.updateNotifications();
    if (customRoll && settings['use-digital-dice']) {
        dndbeyondDiceRoller.sendCustomDigitalDice(character, customRoll);
    }
}

function updateCombatTracker() {
    if (!$(".turn-controls__next-turn-button").length) return;
    const combat = Array.from($(".combatant-card.in-combat")).map(combatant => {
        const $combatant = $(combatant);
        const initiative = $combatant.find(".combatant-card__initiative-value").text() || $combatant.find(".combatant-card__initiative-input").val()
        const tags = Array.from(combatant.classList)
            .filter(c => c.startsWith("combatant-card--"))
            .map(c => c.slice("combatant-card--".length))
        return {
            name: $combatant.find(".combatant-summary__name").text(),
            initiative: initiative,
            turn: $combatant.hasClass("is-turn"),
            tags
        };
    });
    const json = JSON.stringify(combat);
    if (last_combat === json) return;
    last_combat = json;

    const req = {
        action: "update-combat",
        combat,
    };
    console.log("Sending combat update", combat);
    chrome.runtime.sendMessage(req, resp => beyond20SendMessageFailure(character, resp));
    sendRollRequestToDOM(req);

    if (settings["use-beyond-led"])
    {
        if (!led_serial_started) {
            setupBeyondLED();
            return;
        }
        sendCombatUpdateToBeyondLED(combat);
    }
}

function updateSettings(new_settings = null) {
    if (new_settings) {
        settings = new_settings;
        if (character !== null)
            character.setGlobalSettings(settings);
        key_bindings = getKeyBindings(settings)
    } else {
        getStoredSettings((saved_settings) => {
            updateSettings(saved_settings);
            documentModified();
        });
    }
}

function handleMessage(request, sender, sendResponse) {
    if (request.action == "settings") {
        if (request.type == "general")
            updateSettings(request.settings);
    } else if (request.action == "open-options") {
        alertFullSettings();
    }
}

updateSettings();
injectCSS(BUTTON_STYLE_CSS);
chrome.runtime.onMessage.addListener(handleMessage);
const observer = new window.MutationObserver(documentModified);
observer.observe(document, { "subtree": true, "childList": true, attributes: true, });
chrome.runtime.sendMessage({ "action": "activate-icon" });
sendCustomEvent("disconnect");
injectPageScript(chrome.runtime.getURL('dist/dndbeyond_mb.js'));
