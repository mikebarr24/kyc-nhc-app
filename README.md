# kyc-nhc-app

A small web app for scoring cruiser races under the RYA **National Handicap for Cruisers (NHC)**: race places, corrected times and the updated handicap for each boat after every race.

The maths follows the May 2015 NHC algorithm as written up by HalSail: <https://halsail.com/Help/pdfFaq?Faqitem=NhcMaths>.

## Using it

1. **Fleet:** add each boat with its NHC base number (H0).
2. **Races → New race:** set each boat that raced to `FIN` and enter its elapsed time (or switch to finish clock times and give the start time). Leave boats that didn't sail as `DNC`.
3. **Save & calculate:** shows places, corrected times and each boat's new handicap for the next race.
4. **Handicaps:** shows how every boat's handicap has moved over the season.

Results are recalculated from the first race every time, so fixing a time in an old race updates everything after it.

### Sharing results

Data is stored in the browser you're using. The person keeping results can use **Data → Export** after each race and share the file; anyone can **Import** it to see the same results.

## How the calculation works

For each race, using only boats that finished:

- Corrected time `Tc = Te × H1` (rounded to the second); places are ordered by `Tc`.
- Achieved handicap `Ha = ΣH1 / (Te × Σ(1/Te))`.
- Provisional handicap `Hp = 0.7 × H1 + 0.3 × Ha`.
- Boats whose `Tc` is more than one standard deviation from the mean are *extreme performers*: their `Ha` is worked out as if they had finished exactly one standard deviation from the mean, so one bad or lucky race doesn't swing their handicap too far.
- Non-finishers and boats that didn't sail keep `Hp = H1`.
- **Realignment:** every boat that has sailed at least one race this season is scaled so `ΣH2 = ΣH0`, giving `H2 = Hp × ΣH0 / ΣHp`, rounded to 3 decimal places.

The halsail write-up doesn't say whether the standard deviation is the population or sample version. This app uses the population version (divide by *n*).

## Development

No build step. It is plain HTML, CSS and ES modules.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # unit tests for the NHC maths (Node 20+)
```

- `js/nhc.js`: NHC calculations, no DOM.
- `js/app.js`: UI and storage.
- `test/nhc.test.js`: tests.
