#!/usr/bin/env python3
"""Bounded, dependency-free parser for four fixed official aggregate workbooks.

Reads cached values only. Never extracts ZIP paths, executes formulas/macros,
or follows workbook links. Publication decisions remain in arms-economy.mjs.
"""
import argparse
import hashlib
import json
import math
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
WB_TABLES = {
    "DGE_p": ("Informal output — DGE model", "% of official GDP", "model-estimate", "estimated"),
    "MIMIC_p": ("Informal output — MIMIC model", "% of official GDP", "model-estimate", "estimated"),
    "WBentp1": ("Firms competing with unregistered or informal firms", "% of firms", "firm-survey", "reported"),
    "WBentp2": ("Firms formally registered when operations started", "% of firms", "firm-survey", "reported"),
    "WBentp3": ("Years firms operated without formal registration", "years", "firm-survey", "reported"),
    "WBentp4": ("Firms identifying informal competitors as a constraint", "% of firms", "firm-survey", "reported"),
}


def digest(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()[:24]


def number(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("boolean measurement")
    if isinstance(value, str) and not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?", value):
        raise ValueError("unexpected numeric token")
    out = float(value)
    if not math.isfinite(out):
        raise ValueError("non-finite measurement")
    return int(out) if out.is_integer() else out


def parse_xml(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("XML declarations are forbidden")
    return ET.fromstring(data)


def sheets(path, *, skip_formula_rows=0):
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > 512 or sum(x.file_size for x in members) > 80 * 1024 * 1024:
            raise ValueError("workbook expansion limit")
        if len({x.filename for x in members}) != len(members):
            raise ValueError("duplicate ZIP member")
        for entry in members:
            if entry.file_size > 64 * 1024 * 1024 or entry.flag_bits & 1:
                raise ValueError("oversized/encrypted ZIP member")
            if entry.filename.startswith("/") or ".." in entry.filename.split("/") or "\\" in entry.filename:
                raise ValueError("unsafe ZIP path")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = parse_xml(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in root]
            if len(shared) > 200000 or any(len(x) > 20000 for x in shared):
                raise ValueError("shared-string limit")
        relations = {x.get("Id"): x for x in parse_xml(archive.read("xl/_rels/workbook.xml.rels"))}
        workbook = parse_xml(archive.read("xl/workbook.xml"))
        for sheet in workbook.findall("s:sheets/s:sheet", NS):
            relation = relations[sheet.get(RID)]
            if relation.get("TargetMode") == "External":
                raise ValueError("external worksheet")
            target = relation.get("Target", "")
            member = target.lstrip("/") if target.startswith("/xl/") else posixpath.normpath("xl/" + target)
            if not member.startswith("xl/worksheets/") or not member.endswith(".xml"):
                raise ValueError("unexpected worksheet target")
            root = parse_xml(archive.read(member))
            rows = []
            for row in root.findall("s:sheetData/s:row", NS):
                cells = {}
                for cell in row:
                    ref = cell.get("r", "")
                    if not re.fullmatch(r"[A-Z]{1,3}[1-9]\d{0,6}", ref):
                        raise ValueError("invalid cell reference")
                    column = re.sub(r"\d", "", ref)
                    if column in cells:
                        raise ValueError("duplicate cell")
                    if cell.find("s:f", NS) is not None:
                        if int(row.get("r")) <= skip_formula_rows:
                            continue  # Publisher contact hyperlinks, never evidence.
                        raise ValueError("formula cells are not accepted")
                    value = cell.find("s:v", NS)
                    value = value.text if value is not None else ""
                    kind = cell.get("t")
                    if kind == "s":
                        value = shared[int(value)]
                    elif kind == "inlineStr":
                        value = "".join(cell.find("s:is", NS).itertext())
                    elif kind in ("b", "e"):
                        raise ValueError("boolean/error cell")
                    cells[column] = value
                rows.append((int(row.get("r")), cells))
                if len(rows) > 100000:
                    raise ValueError("worksheet row limit")
            yield sheet.get("name"), rows


def indicator(source, title, unit, market, measure, details, limits, key=None):
    return {"id": key or "ae-" + digest([source, title, unit]), "sourceId": source, "market": market,
            "label": title, "unit": unit, "measureType": measure, "description": details, "limitations": limits}


def observation(ind, code, name, period, value, locator, category="", subgroup="", status="reported", lower=None, upper=None):
    territories = {"GBR_S": "GBR-SCT", "GBR_E_W": "GBR-ENG-WLS", "GBR_NI": "GBR-NIR", "IRQ_C": "IRQ-C"}
    geo_level = "region" if code in territories else "country"
    code = territories.get(code, code)
    if not re.fullmatch(r"[A-Z]{3}(?:-[A-Z]{1,3})*", code) or not name or not re.fullmatch(r"(?:19|20)\d{2}", period):
        raise ValueError("invalid country or annual period")
    if lower is not None and upper is not None and lower > upper:
        raise ValueError("reversed interval")
    if value is not None and ((lower is not None and value < lower) or (upper is not None and value > upper)):
        raise ValueError("measurement outside interval")
    return {"id": "ae-" + digest([ind, code, period, category, subgroup]), "indicatorId": ind,
            "geoCode": code, "geoName": name, "geoLevel": geo_level, "period": period,
            "category": category, "subgroup": subgroup, "value": value, "lower": lower, "upper": upper,
            "status": "unavailable" if value is None else status, "sourceLocator": locator}


def normalize(path, kind):
    indicators, observations = {}, []
    book = list(sheets(path, skip_formula_rows=2 if kind.startswith("unodc-") else 0))
    if kind == "wb-informality":
        selected = {name: rows for name, rows in book if name in WB_TABLES}
        if set(selected) != set(WB_TABLES):
            raise ValueError("missing reviewed World Bank table")
        for name, rows in selected.items():
            title, unit, measure, status = WB_TABLES[name]
            header = rows[0][1]
            if header.get("A") != "Economy" or header.get("B") != "Code":
                raise ValueError("World Bank header drift")
            periods = {col: value for col, value in header.items() if col not in ("A", "B")}
            if set(periods.values()) != {str(y) for y in range(1990, 2021)}:
                raise ValueError("World Bank period header drift requires review")
            model = name in ("DGE_p", "MIMIC_p")
            limits = ["Informality includes lawful unregistered activity; this is not the size of illegal or organized-crime markets.",
                      "The retained workbook ends in 2020; retrieval does not make these historical observations current."]
            limits += ["DGE and MIMIC are alternative model estimates, not independent measured totals or uncertainty bounds."] if model else ["Country survey years are sparse; respondents are surveyed firms, not all workers or all informal businesses."]
            ind = indicator(kind, title, unit, "economy", measure,
                            "World Bank Informal Economy Database, " + name + "; original workbook units retained.", limits,
                            key="wb-informal-" + name.lower().replace("_", "-"))
            indicators[ind["id"]] = ind
            for rownum, row in rows[1:]:
                if not row.get("A") and not row.get("B"):
                    continue
                for col, period in periods.items():
                    value = number(row.get(col))
                    if value is not None and (value < 0 or (unit == "% of firms" and value > 100)):
                        raise ValueError("World Bank measurement outside declared unit bounds")
                    observations.append(observation(ind["id"], row.get("B", ""), row.get("A", ""), period, value,
                                                    f"{name}!{col}{rownum}", status=status))
    elif kind in ("unodc-arms", "unodc-econ-crime"):
        if len(book) != 1:
            raise ValueError("unexpected UNODC worksheets")
        name, rows = book[0]
        expected = ["Iso3_code", "Country", "Region", "Subregion", "Indicator", "Dimension", "Category", "Sex", "Age", "Year", "Unit of measurement", "VALUE", "Source"]
        if [rows[2][1].get(chr(65+i)) for i in range(13)] != expected:
            raise ValueError("UNODC header drift")
        for rownum, row in rows[3:]:
            if row.get("K") not in ("Counts", "Rate per 100,000 population"):
                raise ValueError("unreviewed UNODC unit")
            title = row["E"] + " — " + row["F"]
            ind = indicator(kind, title, row["K"], "arms" if kind == "unodc-arms" else "economy", "administrative-count" if row["K"] == "Counts" else "administrative-rate",
                            "Country-reported administrative aggregates. Category retains the source disaggregation; subgroup preserves sex, age and reporting source.",
                            ["Reported seizures and offences reflect enforcement, reporting and legal definitions; they are not total illicit-market size.",
                             "Alternative dimensions and totals overlap and must not be summed across categories."])
            indicators[ind["id"]] = ind
            value = number(row.get("L"))
            if value is not None and value < 0:
                raise ValueError("negative administrative measurement")
            observations.append(observation(ind["id"], row["A"], row["B"], row["J"], value, f"{name}!L{rownum}",
                                            row.get("G", ""), f"sex={row.get('H', '')}; age={row.get('I', '')}; source={row.get('M', '')}"))
    elif kind == "unodc-iffs":
        if len(book) != 1 or book[0][1][2][1].get("C") != "indicator":
            raise ValueError("UNODC SDG header drift")
        name, rows = book[0]
        for rownum, row in rows[3:]:
            if row.get("C") != "16.4.1":
                continue
            if row.get("S") != "Estimated value" or "Million USD, actual value" not in row.get("D", ""):
                raise ValueError("IFF definition drift")
            ind = indicator(kind, row["D"], "million current USD", "economy", "illicit-flow-estimate",
                            "SDG 16.4.1: estimated cross-border illicit financial flows for the stated activity and direction.",
                            ["Sparse country/activity coverage is not a global total; inward and outward flows must not be summed as independent markets.",
                             "Values are current dollars; uncertainty bounds are retained when published."])
            indicators[ind["id"]] = ind
            observations.append(observation(ind["id"], row["I"], row["H"], row["J"], number(row.get("P")), f"{name}!P{rownum}",
                                            row.get("O", ""), "; ".join(f"{k}={row.get(c, '')}" for k, c in [("drug", "M"), ("crime", "N"), ("sex", "K"), ("age", "L")]),
                                            status="estimated", lower=number(row.get("Q")), upper=number(row.get("R"))))
    else:
        raise ValueError("unsupported source")
    seen = {}
    ambiguous, duplicates = set(), 0
    for row in observations:
        previous = seen.get(row["id"])
        if previous is not None:
            if not kind.startswith("unodc-"):
                raise ValueError("duplicate observation grain")
            if any(previous[key] != row[key] for key in ("value", "lower", "upper", "status")):
                ambiguous.add(row["id"])
            else:
                duplicates += 1
        else:
            seen[row["id"]] = row
    observations = [row for key, row in seen.items() if key not in ambiguous]
    observations.sort(key=lambda row: (row["indicatorId"], row["geoCode"], row["period"], row["category"], row["subgroup"]))
    return {"indicators": sorted(indicators.values(), key=lambda row: row["id"]), "observations": observations,
            "summary": {"rows": len(observations), "numeric": sum(row["value"] is not None for row in observations),
                        "countries": len({row["geoCode"] for row in observations}), "indicators": len(indicators),
                        "periodStart": min((row["period"] for row in observations), default=None),
                        "periodEnd": max((row["period"] for row in observations), default=None),
                        "statuses": dict(Counter(row["status"] for row in observations)),
                        "ambiguousGrainsExcluded": len(ambiguous), "duplicateIdenticalRows": duplicates}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True, choices=("wb-informality", "unodc-arms", "unodc-econ-crime", "unodc-iffs"))
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    try:
        json.dump(normalize(args.input, args.kind), sys.stdout, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
    except (ValueError, KeyError, IndexError, ET.ParseError, zipfile.BadZipFile) as error:
        print(f"workbook rejected: {error}", file=sys.stderr)
        sys.exit(1)
