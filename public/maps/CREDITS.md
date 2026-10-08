# Pocket Travel map data

The offline route overview uses a deliberately small, bundled map and destination index. Lines join stops in trip order; they are not road routes, distance calculations, or timetable lookups. Unknown destinations receive no coordinates and appear in the ordered route fallback.

## Country outlines and city coordinates

Country outlines are derived from Natural Earth's 1:110m Admin 0 country data. Unused properties were removed and outline coordinates rounded to three decimal places to keep the bundle small. The city coordinates for Lima, Cusco, Arequipa, Puno, La Paz, Uyuni, and Rio de Janeiro are from Natural Earth's populated places data.

Natural Earth data is public domain: [terms of use](https://www.naturalearthdata.com/about/terms-of-use/), [country data](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/), [populated places](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/).

## Additional destinations

The following WGS84 coordinates are attributed to GeoNames under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Values are rounded for a city/island overview and do not identify a hotel, terminal, or exact meeting point.

| Destination | Longitude | Latitude | Source |
| --- | ---: | ---: | --- |
| Aguas Calientes, Peru | -72.5256 | -13.1543 | [GeoNames 7536123](https://www.geonames.org/7536123) |
| San Pedro de Atacama, Chile | -68.20113 | -22.91110 | [GeoNames 3871781](https://www.geonames.org/3871781/san-pedro-de-atacama.html) |
| Ilha Grande, Brazil | -44.23894 | -23.15497 | [GeoNames 3462217](https://www.geonames.org/3462217/ilha-grande.html) |

GeoNames source and license information: [About GeoNames](https://www.geonames.org/about.html).

The ten-place index contains only the existing starter destinations plus Puno from the approved preview. It is not a general geocoder. Destination matching includes the country so, for example, another place named La Paz is not silently assigned Bolivia's coordinates.

## Google Maps links

Search and directions links use Google's documented [universal Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). They open Google Maps only when the user follows the link and require no API key. No Google Maps SDK, tracking parameters, remote map tiles, or billable API calls are used by the overview.
