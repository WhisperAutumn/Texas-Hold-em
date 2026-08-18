# River Room

A browser-based Texas Hold'em table with an authoritative Node.js server. The
server owns the deck, betting turns, random AI actions, and hand settlement.
Browser clients join the same table with a name and a session cookie.

## Start

Node.js 18 or newer is recommended. No package installation is required.

```powershell
node server.js
```

Open `http://localhost:3000`, enter a name, and take a seat. Empty seats are
filled by AI players that randomly fold, check, call, or raise.

## Admin console

Open `http://localhost:3000/server`. The default admin password is
`riverroom-admin` for local development. Set a private password before using
the console on a shared network:

```powershell
$env:ADMIN_PASSWORD = "your-private-password"
node server.js
```

The console can view the live table, issue Token to every seated player, and
save the starting Token amount, blinds, minimum bet, maximum bet per street,
and minimum raise. Rule changes take effect on the next hand and are saved in
`data/table-settings.json`.

## Windows desktop clients

Run the packaging script to create the portable server and player clients:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1
```

The generated packages are in `dist`:

- `River Room Server Client.zip` includes Node.js, the game server, and the
  Server Settings client. Extract it and run `River Room Server.cmd`.
- `River Room Player Client.zip` opens a desktop-style player window. Extract
  it and run `River Room Player.cmd`, then enter the LAN player URL shown by
  Server Settings.

The server package uses `server-config.ps1` for its port and admin password.
Both desktop windows use Microsoft Edge app mode, which is included with
current Windows 10 and Windows 11 installations.

## Join from another device

Start the server, find this computer's LAN IPv4 address (for example
`192.168.1.20`), and open the following address on another device connected to
the same network:

```text
http://192.168.1.20:3000
```

Allow Node.js on private networks if Windows Firewall asks for permission.

## Current rules

- 2,000 starting Token; blinds are 25 / 50 by default.
- Up to five human players; AI fills empty seats.
- Server validates turns and bet ranges.
- Standard five-card hand ranking from seven available cards.
- Automatic action timeout and automatic next hand.

This is a local/LAN play prototype. Player accounts and passwords are not
persistent; the admin password is separate from player login. It does not
include side pots or real-money payments.
