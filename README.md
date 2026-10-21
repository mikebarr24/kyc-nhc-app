# nhc-app

A small web app for scoring cruiser races under the RYA **National Handicap for Cruisers (NHC)**: race places, corrected times and the updated handicap for each boat after every race.

The maths follows the May 2015 NHC algorithm as written up by HalSail: <https://halsail.com/Help/pdfFaq?Faqitem=NhcMaths>.

## Using it

1. **Fleet:** add each boat with its NHC base number (H0).
2. **Races → New race:** set each boat that raced to `FIN` and enter its elapsed time (or switch to finish clock times and give the start time). Leave boats that didn't sail as `DNC`.
3. **Save & calculate:** shows places, corrected times and each boat's new handicap for the next race.
4. **Handicaps:** shows how every boat's handicap has moved over the season.

Results are recalculated from the first race every time, so fixing a time in an old race updates everything after it.

### Sharing results

Results are stored in a [Supabase](https://supabase.com) database, so everyone who opens the site sees the same data and new results appear without refreshing. Anyone can view; to edit, enter your email at the top of the page and click the sign-in link you're sent.

If `js/config.js` has no Supabase settings, the app falls back to storing data in the current browser only.

### Supabase setup (one-off)

1. Create a free project at <https://supabase.com>.
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it.
3. **Authentication → URL Configuration**: set *Site URL* to `https://mikebarr24.github.io/nhc-app/` and add the same URL (plus `http://localhost:8000/` for local testing) under *Redirect URLs*.
4. **Project Settings → API**: copy the *Project URL* and the *anon* / *publishable* key into `js/config.js`, then commit and push.

The anon key is meant to be public. The database rules in `schema.sql` allow anyone to read, but only signed-in users can change anything. To stop new people signing up, turn off **Authentication → Sign In / Providers → Allow new users to sign up** once your group has signed in once.

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
- `js/app.js`: UI.
- `js/store.js`: storage (Supabase or browser).
- `js/config.js`: Supabase project settings.
- `supabase/schema.sql`: database tables and access rules.
- `test/nhc.test.js`: tests.
