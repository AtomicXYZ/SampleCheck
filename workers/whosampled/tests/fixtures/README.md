# HTML fixtures

`relation-historical.html` is a reduced historical WhoSampled page, obtained from
[sample-detection](https://github.com/denisakkavim/sample-detection/blob/bb9aaf5638ef9c34655ddb03d3e818551a58679d/tests/test_files/whosampled_html/sample.html).
Only the heading, track metadata and timestamp containers are retained; scripts,
embeds, adverts, navigation and comments are removed. It is NOT a live capture of
the current website. The snapshot identifies sample 729975 (Dua Lipa / Love Again).

The other HTML fixtures are authored for SampleCheck with fictional tracks. They
exercise known selectors and failure cases, and do not establish live compatibility.

Historical selector references:
- https://github.com/rikaa15/WhoSampled-API/blob/master/index.js
- https://github.com/denisakkavim/sample-detection/blob/bb9aaf5638ef9c34655ddb03d3e818551a58679d/sample_detection/scrape/whosampled.py

The accompanying MIT notice applies to material from sample-detection; see
`sample-detection-LICENSE.txt` in this directory. WhoSampled remains the original
source of the factual metadata.
