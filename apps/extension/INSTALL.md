# Add ZeroFee to Chrome

Extension id: `hfnbcflhfpceemgoglhbonngemobhffd` (pinned 4 Nov by the manifest's public `key`; permanent, never regenerated)

> **Never remove ZeroFee from Chrome.** Removing it erases this computer's keys. Your money stays safe, but you then
> need your 24 words to get back in. To update, follow "To update" below. It keeps everything.

You need Chrome 128 or newer on a computer.

1. Get the zip from the ZeroFee website. It is called `zerofee-extension-<version>.zip`.
2. Check it is the real one. The website shows a long code (its sha256). Open Terminal and type:

   ```
   shasum -a 256 ~/Downloads/zerofee-extension-<version>.zip
   ```

   On Windows, open PowerShell and type `Get-FileHash $HOME\Downloads\zerofee-extension-<version>.zip`.

   The code it shows must be the same as the website's (big or small letters don't matter). If it is not the same, stop. Delete the zip.
3. Open the zip. You get a folder called `zerofee-extension-<version>`.
4. Put that folder somewhere it can stay, like your Documents. Chrome uses it from there. Don't delete it.
5. In Chrome, go to `chrome://extensions`.
6. Turn on **Developer mode**. It is at the top right.
7. Click **Load unpacked**.
8. Pick the `zerofee-extension-<version>` folder. ZeroFee is now in Chrome.
9. Click the puzzle piece at the top right of Chrome. Click the pin next to ZeroFee. Now it stays in view.

## To update

Keep the same folder. Never remove ZeroFee, and never load a second copy.

1. Get the new zip, and check it (step 2 above).
2. Open it. Open the new folder inside it.
3. Select everything in the new folder. Copy it into your ZeroFee folder (the one from step 4 above). Say yes to
   replace the files.
4. In Chrome, go to `chrome://extensions`. Find ZeroFee. Click its **Reload** button (the round arrow).

ZeroFee now runs the new version, with your account, your keys and your iPhone key just as before.

## Check that the zip matches the code

Anyone can build the zip from the code and get the same bytes. You need git and Node 24.13.0 (the build stops on any
other version).

```
git clone --branch <tag> <ZeroFee's repository> zerofee
cd zerofee
bash tools/extension/build-zip.sh
```

Use the tag the website names for that zip. The script installs the exact packages in `package-lock.json`, builds the
extension, and writes `dist/zerofee-extension-<version>.zip`. It prints the zip's sha256 last. It must be the same as
the website's.

The zip's dates are the time of the tag's commit, so the same commit always gives the same zip.
