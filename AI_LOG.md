# AI log

Most of the code was written with Claude Code. Three times it was sure about something that turned out to be wrong.

## Nike's missing disaster site

Between two runs, Nike's count of sites inside disaster areas went from 3 to 2. Claude Code put it down to the GDACS feed changing, which happens with live data, so it saw nothing to fix. I checked the drought in Brazil directly on GDACS: it was still active, and the Nike site was still inside it. The app had simply never picked that event up. When you ask GDACS for every event type in one go, its paging repeats some rows and drops others (1,844 rows for 1,827 events). It now fetches one event type at a time, and there's a test for it.

## The map styles

After the Plain / Map / Satellite switch went in, Claude Code reported that the sites and disaster areas stay on top in every style. When I actually clicked through it, they were gone for up to a minute after switching to Satellite, and Plain came back blank. The switch was replacing the whole map style, and my layers with it. Now only the base map underneath changes.

## "NULL" as a company

Everything passed: the tests, the data checks, 0 differences. Then I loaded Amazon's list, and its biggest "owner" was NULL, with 12 sites. The text "null" in the owner column was being treated as a company name, and adidas and Nike had it too (4 and 2 sites). The checks hadn't caught it because they were built on the same assumption as the code. It's filtered out now, and adidas's "owner known" moved from 552 to 551.
