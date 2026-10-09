# Letters!

The fast-paced, shout-it-out party game for 2 to 30 players, played on one phone.

One player is the **Judge**. The Judge's phone is the deck: each card shows a random
letter and two topics. The Judge reads the letter and one topic out loud, everyone
else races to yell a word that fits, and the Judge taps the winner's name to award
the card. Each card is one **Letter**. First to the target score (5, 10, 15 or 20)
wins, or play Casual mode with no scores at all, and no names needed.

## Play it

This is a plain static web app: no build step, no dependencies.

- Open `index.html` in any browser, or
- Serve the folder with any static server, for example:

  ```sh
  npx serve .
  # or
  python3 -m http.server 8080
  ```

It is installable as a home-screen app (web manifest + service worker) and works
offline once loaded. Deploy it to GitHub Pages, Netlify, Vercel or any static host
by pointing at the repository root.

## iPhone and Android apps

The same web app is wrapped as native iOS and Android apps with
[Capacitor](https://capacitorjs.com). The native projects live in `ios/` and
`android/` and load the web files from a staged `www/` folder.

```sh
npm install          # Capacitor CLI, native platforms and plugins
npm run sync         # stage web files into www/ and copy them into both native projects
npm run ios          # sync, then open the Xcode project (needs a Mac with Xcode)
npm run android      # sync, then open the project in Android Studio
```

Run `npm run sync` after every change to the web files. iOS uses Swift Package
Manager, so CocoaPods is not required.

**Store icons and splash screens** are generated from the source images in
`assets/` with `npm run assets` (iOS and Android sets only; the PWA icons in
`icons/` are committed directly).

**Native touches**: the screen stays awake while a card is showing
(`@capacitor-community/keep-awake`, Screen Wake Lock API on the web), awarding a
card gives haptic feedback (`@capacitor/haptics`, `navigator.vibrate` on the web),
and the service worker is skipped inside the native shell because the files ship
with the app. All of it falls back quietly in a plain browser, so the web version
is unchanged.

**Shipping to the stores**

1. iOS: open the project with `npm run ios`, set your Team under *Signing &
   Capabilities*, bump the version and build number, then *Product > Archive* and
   upload to App Store Connect. The app id is `com.lettersgame.app`; change it in
   `capacitor.config.json` and `ios/App/App.xcodeproj` before your first upload if
   you want a different one.
2. Android: open with `npm run android`, create an upload keystore, then
   *Build > Generate Signed Bundle* to produce the `.aab` for the Play Console.
   The application id is set in `android/app/build.gradle`.

## Features

- **Setup**: the Judge adds 2 to 30 player names and hits Start. In Casual mode names
  are optional: hit **Quick Play** on the home screen and just tap *Next card*.
- **Digital deck**: nearly 1,000 easy topic prompts (`js/topics.js`) plus a weighted
  letter bag. The deck carries over between games, so topics never repeat until the
  whole deck has been used, and a letter sits out for 8 cards before it can come back.
- **Judge mode**: the Judge is shown on the card screen and cannot win their own
  card. Change the Judge any time, or turn on *Pass the phone* to rotate the Judge
  after every card.
- **Award Letters**: tap a player's name to award the card. Undo from the toast if
  you tapped the wrong person. Skip a card that stumps everyone.
- **Classic mode**: first to 5, 10, 15 or 20 Letters wins (you pick), with a
  scoreboard and a confetti victory screen. **Casual mode**: no scores, just cards.
- **Extras**: optional round timer (15 / 30 / 60 s) and a toggle for the tricky
  letters Q, X and Z.
- Game state is saved to the browser, so an accidental refresh offers *Resume Game*.

## Project layout

```
index.html            all screens (home, how to play, setup, game, victory, summary)
css/styles.css        pastel palette, Fredoka rounded type, mobile-first layout
js/topics.js          the prompt deck
js/app.js             game state, deck logic, rendering, timer, confetti
manifest.webmanifest  PWA manifest
sw.js                 offline cache
icons/icon.svg        app icon
```

## Design

Pastel palette (mint, peach, lavender, sky, lemon, pink on cream) with dark plum
text. Type is [Fredoka](https://fonts.google.com/specimen/Fredoka), a rounded bold
sans, with rounded system fallbacks.
