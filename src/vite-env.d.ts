/// <reference types="vite/client" />

// world-atlas ships topojson as JSON; the map renderer converts it to GeoJSON.
declare module 'world-atlas/*.json' {
  import type { CountriesTopology } from './lib/mapSvg'

  const value: CountriesTopology
  export default value
}
