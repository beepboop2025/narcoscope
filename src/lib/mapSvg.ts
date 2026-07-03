import { geoGraticule, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry, LineString, Position } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'

export type LngLat = [number, number]

export interface CountriesTopology extends Topology {
  objects: {
    countries: GeometryCollection
  }
}

export function countriesFromTopology(topology: unknown): Feature<Geometry>[] {
  const countriesTopology = topology as CountriesTopology
  const collection = feature(countriesTopology, countriesTopology.objects.countries) as FeatureCollection<Geometry>
  return collection.features
}

export function pathForGeometry(projection: GeoProjection, geometry: Geometry): string {
  return geoPath(projection)(geometry) ?? ''
}

export function graticulePath(projection: GeoProjection): string {
  return geoPath(projection)(geoGraticule()()) ?? ''
}

export function projectedPoint(projection: GeoProjection, coordinates: LngLat): [number, number] | null {
  const point = projection(coordinates)
  return point ? [point[0], point[1]] : null
}

export function arcPath(projection: GeoProjection, from: LngLat, to: LngLat): string {
  const interpolate = geoInterpolate(from, to)
  const coordinates: Position[] = Array.from({ length: 32 }, (_, index) => interpolate(index / 31))
  const line: LineString = { type: 'LineString', coordinates }
  return geoPath(projection)(line) ?? ''
}
