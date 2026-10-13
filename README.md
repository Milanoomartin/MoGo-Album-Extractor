# MONOPOLY GO Universal Album Extractor

A standalone Tampermonkey script for capturing and exporting the album that
the official Monopoly GO website currently supplies. It discovers the album
ID, set names, sticker names, rarity, and public artwork at runtime. 
## Install and export

1. Create a **new script** in Tampermonkey and paste the contents of
   `monopolygo-album-extractor.user.js`, then save. You can also open the
   `.user.js` file to install it if your browser supports local installation.
2. Open **https://www.monopolygo.com/sticker-album** while signed in.
3. Reload that page once after installation. The extractor captures the site's
   live album response and public artwork manifest automatically.
4. Check **Artwork mapped** and **Full card layers**, then click
   **Export everything (ZIP)**. Every captured sticker is exported, including
   stickers you do not own. Search and set filters affect the preview only.
