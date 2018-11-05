// How long ago to look for log messages.
var LOOKBACK_SECONDS = 60 * 60 * 24 * 7 * 4; // 4 weeks

var ERA_SECONDS = 1000000;

var LOCALSTORAGE_USERS_KEY = 'users';
var LOCALSTORAGE_USERS_LAST_ETAG_KEY = 'users-last-etag';

const ALL_USERS = "*";

var DOM = {
    create(tag, attrs = {}) {
        const node = document.createElement(tag);
        for (const [name, value] of Object.entries(attrs)) {
            node.setAttribute(name, value);
        }
        return node;
    },
    createText(...args) {
        return document.createTextNode(...args);
    },
    byId(id) {
        return document.getElementById(id);
    },
    clearChildren(node) {
        var n;
        while (n = node.lastChild) {
            node.removeChild(n);
        }
    }
};

var $HEADER_TITLE = DOM.byId('header-title');
var $HEADER_DATE = DOM.byId('header-date');
var $LIST = DOM.byId('thelist');

var urls = {
    logbot(channel, when, user) {
        return `http://mozilla.logbot.info/${channel}/link/${when}/${user}`;
    },
    edit(user, era) {
        return `https://github.com/mrgiggles/histoire/edit/master/users/${user}/${user}.${era}.txt`;
    },
    data(user, era) {
        return `https://raw.githubusercontent.com/mrgiggles/histoire/master/users/${user}/${user}.${era}.txt`;
    },
    bug(bugNumber) {
        return `https://bugzilla.mozilla.org/show_bug.cgi?id=${bugNumber}`;
    },
    list_users() {
        return `https://api.github.com/repos/mrgiggles/histoire/contents/users`;
    },
    user_page(username) {
        return `?user=${username}`;
    }
}

function toDateString(when) {
  const date = new Date(when * 1000);
  try {
    return new Intl.DateTimeFormat(navigator.languages, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: "short",
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  } catch (e) {
    return date.toLocaleString();
  }
}

// Linkify `message` string and add it to `parent` node.
function linkifyAndAdd(parent, message) {
    const searches = [
        {
            regexp: /bug (\d+)/i,
            createLink: match => urls.bug(match[1])
        },
        {
            // Shamelessly taken from Stackoverflow:
            // https://stackoverflow.com/questions/3809401/what-is-a-good-regular-expression-to-match-a-url
            regexp: /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/i,
            createLink: match => match[0]
        }
    ];

    while (true) {
        let matches = [];
        for (let search of searches) {
            const match = message.match(search.regexp);
            if (match !== null) {
                matches.push({
                    search,
                    match
                });
            }
        }

        if (matches.length === 0) {
            // Exit if no regular expressions matched.
            break;
        }

        matches.sort((a, b) => message.match.indexOf(a[0]) < message.match.indexOf(b[0]));

        // Only consider the first match; others will be handled in the next
        // iterations.
        const { search, match } = matches[0];

        const matched = match[0];
        const beforeText = message.substr(0, message.indexOf(matched));
        const afterText = message.substr(message.indexOf(matched) + matched.length, message.length);

        parent.appendChild(DOM.createText(beforeText));

        const link = DOM.create("a", {href: search.createLink(match)});
        link.textContent = matched;
        parent.appendChild(link);

        message = afterText;
    }

    if (message) {
        const text = DOM.createText(message);
        parent.appendChild(text);
    }
}

function addItem({era, when, user, message, channel}, showUserLink) {
    const when_str = toDateString(when)

    const item = DOM.create("li");
    if (channel.startsWith("#")) {
        let link = urls.logbot(channel.substr(1), when, user);
        const ahref = DOM.create("a", {href: link});
        ahref.textContent = when_str;
        item.appendChild(ahref);
    } else {
        const text = DOM.createText(`${when_str}`);
        item.appendChild(text);
    }

    // Let's try to find bug numbers.
    item.appendChild(DOM.createText(" - "));
    if (showUserLink) {
        const link = DOM.create("a", {href: urls.user_page(user) });
        link.textContent = user;
        item.appendChild(link);
        item.appendChild(DOM.createText(" - "));
    }
    linkifyAndAdd(item, message);

    item.appendChild(DOM.createText(" "));
    const edit = DOM.create("a", {href: urls.edit(user, era), target: "_blank"});
    edit.appendChild(DOM.create("img", {src: "icons/edit.png", height: 10}));
    item.appendChild(edit);

    $LIST.appendChild(item);
};

function parseResults(responseText, user, era, start, end) {
    const results = [];
    for (let line of responseText.split('\n')) {
        if (line === '') {
            continue;
        }
        const [_, when, channel, message] = line.match(/^(\S+) (\S+) (.*)/);
        if (when < start || when > end) {
            continue;
        }
        results.push({user, era, when, channel, message});
    }
    return results;
}

function renderAllUsersLink(users) {
    let li = DOM.create("li");
    let link = DOM.create("a", {href: urls.user_page(ALL_USERS)});
    link.textContent = "All users";
    li.appendChild(link);
    $LIST.appendChild(li);
}

function renderUser(name) {
    let li = DOM.create("li");
    let link = DOM.create("a", {href: urls.user_page(name)});
    link.textContent = name;
    li.appendChild(link);
    $LIST.appendChild(li);
}

function loadUsers() {
    return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', ev => resolve(xhr));
        xhr.open("GET", urls.list_users());

        let lastEtag = localStorage.getItem(LOCALSTORAGE_USERS_LAST_ETAG_KEY);
        if (lastEtag !== null) {
            xhr.setRequestHeader('If-None-Match', lastEtag);
        }

        xhr.send();
    });
}

async function getUserList() {
    const xhr = await loadUsers();

    let status = (xhr.status / 100 | 0);
    // If the status code isn't in the 200 or 300 family, it's an error.
    if (status !== 2 && status !== 3) {
        let message;
        try {
            let json = JSON.parse(xhr.responseText);
            if (typeof json.message !== 'undefined') {
                message = json.message;
            } else {
                throw new Error();
            }
        } catch (_) {
            message = xhr.responseText;
        }
        $HEADER_TITLE.textContent = `Error when fetching the list of users: ${message}`;
        return null;
    }

    let users;
    if (xhr.status === 304) {
        // Content not modified; reload from the cache.
        users = JSON.parse(localStorage.getItem(LOCALSTORAGE_USERS_KEY));
    } else {
        let json;
        try {
            json = JSON.parse(xhr.responseText);
        } catch (ex) {
            alert("Error when parsing the list of users: " + ex.toString());
            return null;
        }
        users = json.map(x => x.name).filter(name => name !== '.gitattributes');

        let etag = xhr.getResponseHeader('ETag');
        if (etag !== null) {
            localStorage.setItem(LOCALSTORAGE_USERS_LAST_ETAG_KEY, etag);
            localStorage.setItem(LOCALSTORAGE_USERS_KEY, JSON.stringify(users))
        }
    }

    return users;
}

async function listUsers() {
    const users = await getUserList();
    if (!users) {
        return;
    }
    renderAllUsersLink(users);
    users.map(renderUser);
    $HEADER_TITLE.textContent = "Users";
}

function loadNotes(user, era) {
    // index.html and index.js are loaded through rawgit.com, which routes them
    // through a CDN that caches aggressively. That doesn't work for the data
    // files, which are expected to be updated frequently. So we go through
    // github directly for those -- but note, not the /raw/ URL, since that
    // does not allow CORS, but the raw.githubusercontent.com link.

    return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = 'text';
        xhr.addEventListener('load', ev => resolve(xhr));
        xhr.open("GET", urls.data(user, era));
        xhr.send();
    });
}

function computeEra(time_sec) {
    return time_sec - (time_sec % ERA_SECONDS);
}

async function loadUserNotes(user, start, end) {
    let users;
    if (user === ALL_USERS) {
        users = await getUserList();
        if (!users) {
            return;
        }
    } else {
        users = user.split(",").filter(x => x);
    }

    if (!end) {
        end = Date.now() / 1000; // ms -> sec
    }
    if (!start) {
        start = end - LOOKBACK_SECONDS;
    }

    DOM.clearChildren($LIST);

    const resultPromises = [];
    for (let era = computeEra(end); era >= computeEra(start); era -= ERA_SECONDS) {
        for (const user of users) {
            resultPromises.push((async () => {
                const xhr = await loadNotes(user, era);

                // 404 is ok; there might not be any entries for that time
                // range.
                if (xhr.status == 404) {
                    return [];
                }

                return parseResults(xhr.responseText, user, era, start, end);
            })());
        }
    }
    // All attempted data is loaded.
    const results = [].concat(...await Promise.all(resultPromises));
    if (results.length === 0) {
        $HEADER_TITLE.textContent = "No updates found!";
        return;
    }

    // Sort results by reverse date before rendering them.
    results.sort((a, b) => {
        return a.when < b.when  ? 1
             : a.when >= b.when ? -1
                                : 0;
    });
    const showUserLink = users.length > 1;
    for (const result of results) {
        addItem(result, showUserLink);
    }

    const start_str = toDateString(start);
    const end_str = toDateString(end);
    const userName = user === ALL_USERS ? "all users" : users.join(", ");
    $HEADER_TITLE.textContent = `Updates for ${userName}`;
    $HEADER_DATE.textContent = `from ${start_str} to ${end_str}`;
}

var params = new URL(document.location).searchParams;
var user = params.get("user");
if (user) {
    loadUserNotes(user, params.get("start"), params.get("end"));
} else {
    listUsers();
}
