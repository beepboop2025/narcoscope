#!/usr/bin/env python3
"""Normalize reviewed WDR 2026 and StatCan aggregate tables; no executable input."""
import argparse
import csv
import hashlib
import importlib.util
import io
import json
import re
import sys
import zipfile
from pathlib import Path

_spec = importlib.util.spec_from_file_location("bounded_workbook", Path(__file__).with_name("arms-economy-xlsx.py"))
_reader = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_reader)
sheets, number = _reader.sheets, _reader.number

def digest(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()[:24]

def indicator(source, key, label, unit, measure, description, limits):
    return dict(id=key, sourceId=source, market="drugs", label=label, unit=unit,
                measureType=measure, description=description, limitations=limits)

def observation(ind, code, name, period, category, subgroup, value, locator, *, level="country", status="reported", lower=None, upper=None):
    if not re.fullmatch(r"(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?", period):
        raise ValueError("unexpected period")
    if value is not None and value < 0:
        raise ValueError("negative measurement")
    if value is None:
        lower = upper = None
    if value is not None and ((lower is not None and lower > value) or (upper is not None and upper < value)):
        raise ValueError("source interval does not contain estimate")
    return dict(id="dr-"+digest([ind,code,period,category,subgroup]), indicatorId=ind, geoCode=code,
                geoName=name, geoLevel=level, period=period, category=category, subgroup=subgroup,
                value=value, lower=lower, upper=upper, status="unavailable" if value is None else status,
                sourceLocator=locator)

def check_header(rows, rownum, expected):
    row = dict(rows).get(rownum, {})
    if any(row.get(col) != value for col, value in expected.items()):
        raise ValueError("reviewed source header changed")

def public_number(value):
    if value in (None, "", "...", ".."):
        return None
    return number(value)

def normalize(path, kind, countries=None):
    indicators, observations, audit = {}, [], {"omittedRows":0,"identicalDuplicates":0,"correctedSourceLabels":0}
    country_map = countries or {}
    def add(ind, row):
        indicators[ind["id"]] = ind
        observations.append(row)
    def country(label, code=None):
        label=label.strip()
        if code:
            if not re.fullmatch(r"[A-Z]{3}", code): raise ValueError("invalid ISO3")
            return code, country_map.get(code, label)
        if label not in country_map: raise ValueError("unmapped country: "+label)
        return country_map[label]
    enforcement = ["Seizures and detected sites reflect enforcement, reporting and definitions, not all drug production or market size.",
                   "Drug groups, substances and totals can overlap; do not sum categories or compare with cultivation as an interdiction rate."]
    if kind.startswith("statcan-"):
        product=kind.split("-")[1]
        with zipfile.ZipFile(path) as z:
            members=z.infolist()
            if len(members)!=2 or sum(x.file_size for x in members)>12*1024*1024 or len(set(x.filename for x in members))!=2:
                raise ValueError("unexpected StatCan archive")
            if set(x.filename for x in members)!={product+".csv",product+"_MetaData.csv"}:
                raise ValueError("unexpected StatCan paths")
            rows=list(csv.DictReader(io.StringIO(z.read(product+".csv").decode("utf-8-sig"))))
        if len(rows)>30000: raise ValueError("StatCan row limit")
        old=product=="13100820"
        expected="Load per capita (grams per one million people per day)" if old else "Load per capita (milligrams per one thousand people per day)"
        unit="grams per million people per day" if old else "milligrams per thousand people per day"
        bound_names=["Lower bound of the 95% confidence interval, load per capita","Upper bound of the 95% confidence interval, load per capita"] if old else ["Low 95% confidence interval, load per capita","High 95% confidence interval, load per capita"]
        indexed={}
        for rn,row in enumerate(rows,2):
            key=(row["REF_DATE"],row["GEO"],row["Measure"],row["Characteristics"])
            if key in indexed: raise ValueError("duplicate StatCan source cell")
            indexed[key]=(rn,row)
        ind=indicator(kind,kind+"-monthly-load","Wastewater residue load — monthly sampled week",unit,"wastewater-estimate",
            "Canadian Wastewater Survey monthly estimates for each reported analyte, with published 95% confidence bounds. Original units and analyte labels retained.",
            ["Samples cover a seven-day collection window, not every day of the month. Missing samples may be imputed by Statistics Canada.",
             "Residue loads are not numbers of users or annual consumption. Parent compounds, metabolites, prescription use and disposal must not be conflated.",
             "Source quality flag E means use with caution; F means too unreliable to publish. Flags are retained in sourceLocator.",
             "2023 samples are reported for January, March, May, July, September and November only; no missing month is filled.",
             "Weighted multi-city averages are excluded to avoid counting the same cities twice. Census/catchment methods differ between releases."])
        for rn,row in enumerate(rows,2):
            if row["Characteristics"]!=expected or row["GEO"]=="Weighted average, cities measured": continue
            if row["SCALAR_FACTOR"]!="units" or row["SCALAR_ID"]!="0": raise ValueError("StatCan scalar changed")
            status=row["STATUS"]
            if status not in ("","E","F","x","..","...","p","r"): raise ValueError("unknown StatCan quality flag")
            value=public_number(row["VALUE"]) if status not in ("F","x","..","...") else None
            bounds=[];locs=[]
            for name in bound_names:
                entry=indexed.get((row["REF_DATE"],row["GEO"],row["Measure"],name))
                bounds.append(public_number(entry[1]["VALUE"]) if entry and entry[1]["STATUS"] not in ("F","x") else None)
                if entry:locs.append(str(entry[0]))
            code="CAN-CITY-"+re.sub(r"[^a-z0-9]+","-",row["GEO"].lower()).strip("-")
            add(ind,observation(ind["id"],code,row["GEO"],row["REF_DATE"],row["Measure"],"",value,
                f"{product}.csv row {rn}; VECTOR={row['VECTOR']}; quality={status or 'unflagged'}; 95% CI rows={','.join(locs)}",
                level="city",status="estimated",lower=bounds[0],upper=bounds[1]))
    else:
        book=dict(sheets(path))
        if kind=="wdr2026-seizures":
            rows=book["Seizures"]
            check_header(rows,2,{"A":"Iso3_code","D":"Country","G":"DrugName","H":"Reference year","I":"Kilograms"})
            ind=indicator(kind,"wdr2026-seizures-kg","Reported drug seizures","kg","administrative-seizure",
                "World Drug Report 2026 annex 7.1; country, drug group/subgroup and substance retained. Source Kilograms column is used without further conversion.",enforcement)
            for rn,r in rows:
                if rn<3 or not r.get("A"):continue
                code,name=country(r["D"],r["A"])
                subgroup=" | ".join(x for x in [r.get("E"),r.get("F"),"source="+r.get("J","")] if x)
                drug=r.get("G", "Unspecified substance")
                locator=f"Seizures!I{rn}; footnote={r.get('K','')}"
                # The publisher's footnote independently supplies the clean label.
                # This exact reviewed source typo is not a general numeric-cleaning rule.
                clean_doc="2,5-Dimethoxy-4-chloroamphetamine (DOC)"
                if drug==clean_doc+"\t 0.06":
                    if r.get("K")!=clean_doc:raise ValueError("reviewed DOC label footnote changed")
                    locator+=f"; label corrected from G{rn}={drug!r} using matching K{rn}; numeric value remains I{rn}"
                    drug=clean_doc;audit["correctedSourceLabels"]+=1
                add(ind,observation(ind["id"],code,name,r["H"],drug,subgroup,public_number(r.get("I")),locator))
        elif kind=="wdr2026-prices":
            units={"Grams":"gram","Gram":"gram","Kilogram":"kilogram","Kilograms":"kilogram","Tablets":"tablet","1000 tablets":"1000 tablets","1000 units":"1000 units","Units":"unit","Litres":"litre","Millilitres":"millilitre","Ounce":"ounce","Pounds":"pound"}
            for sheet,purity in [("Prices in USD",False),("Purities",True)]:
                rows=book[sheet]
                check_header(rows,2,{"C":"Country/Territory","H":"Year","I":"Typical" if purity else "Typical_USD","L":"Measurement" if purity else "Unit"})
                for rn,r in rows:
                    if rn<3 or not r.get("C"):continue
                    native=r.get("L","")
                    if native in ("","..."):audit["omittedRows"]+=1;continue
                    unit=({"% (percent)":"%","mg/tablet":"mg per tablet"}.get(native) if purity else "USD per "+units[native])
                    if not unit: raise ValueError("unknown purity unit")
                    code,name=country(r["C"])
                    drug=r.get("F" if purity else "E","");level=r.get("D" if purity else "G","");spec=r.get("G" if purity else "F","")
                    subgroup="sale="+level+("; specification="+spec if spec else "")+f"; source entry={rn}"
                    for col,stat in [("I","typical"),("J","minimum"),("K","maximum")]:
                        key="wdr2026-"+("purity" if purity else "price")+"-"+stat+"-"+re.sub(r"[^a-z0-9]+","-",unit.lower()).strip("-")
                        ind=indicator(kind,key,("Drug purity/potency" if purity else "Drug price")+" — "+stat,unit,"reported-purity" if purity else "reported-price",
                            "UNODC WDR 2026 annex 8.1. Statistics, sale levels, forms and original units remain separate. A typical value is not manufactured from a one-sided range.",
                            ["Price units and retail/wholesale levels are not interchangeable. USD prices are nominal, not inflation- or purchasing-power-adjusted.",
                             "Purity sampling and price-reporting methods differ across countries. Source minimum/maximum are reported ranges, not statistical confidence intervals.",
                             "Substances and unspecified drug groups overlap; do not sum categories. Missing values remain unavailable."])
                        add(ind,observation(ind["id"],code,name,r["H"],drug,subgroup,public_number(r.get(col)),f"{sheet}!{col}{rn}"))
        elif kind=="wdr2026-treatment":
            rows=book["Sheet1"];check_header(rows,3,{"C":"Country","D":"msCode","E":"Reference year","G":"Drug","H":"Sex","I":"value"})
            ind=indicator(kind,"wdr2026-treatment-persons","Persons treated — primary drug of use","persons","treatment-administrative-count",
                "Country-reported number of persons treated for drug problems, by primary drug and sex. Coverage can refer to selected facilities or subnational areas; it is retained in each source locator.",
                ["Treatment reporting and facility coverage differ across countries and years; these are not national prevalence or unmet-need estimates.",
                 "Sex totals overlap male/female/other categories; broad drug groups may overlap specific substances. Do not sum these alternatives.",
                 "Counts reflect people recorded in treatment systems, not everyone with a substance-use disorder."])
            for rn,r in rows:
                if rn<4 or not r.get("D"):continue
                if not re.fullmatch(r"(?:19|20)\d{2}",r.get("E","")):
                    audit["omittedRows"]+=1
                    continue
                code,name=country(r["C"],r["D"]);coverage=r.get("K","")
                subgroup="sex="+r["H"]+"; group="+r.get("F","")
                if coverage:subgroup+="; coverage="+coverage[:180]+(" ["+digest([coverage])+ "]" if len(coverage)>180 else "")
                value=public_number(r.get("I"))
                if value is not None and value%1:raise ValueError("non-integer treatment count")
                add(ind,observation(ind["id"],code,name,r["E"],r["G"],subgroup,value,f"Sheet1!I{rn}; coverage={coverage[:1400]}; reference note={r.get('J','')[:200]}"))
        elif kind=="wdr2026-labs":
            rows=book["Labs"];check_header(rows,1,{"C":"Country","D":"iso3","E":"End Product","O":"Reference year"})
            header=rows[0][1]
            for col in "FGHIJKLMN":
                label=header[col];ind=indicator(kind,"wdr2026-sites-"+col.lower(),label,"sites","administrative-detection",
                    "UNODC WDR 2026 annex 9.1; detected/dismantled sites by reported end product. Original facility classes are separate indicators.",enforcement)
                for rn,r in rows:
                    if rn<2 or not r.get("D"):continue
                    code,name=country(r["C"],r["D"])
                    add(ind,observation(ind["id"],code,name,r["O"],r["E"],"",public_number(r.get(col)),f"Labs!{col}{rn}"))
        else:raise ValueError("unsupported reviewed source")
    seen={};out=[];ambiguous=set()
    for row in observations:
        if row["id"] in seen:
            previous=seen[row["id"]]
            if any(previous[k]!=row[k] for k in ("value","lower","upper","status")):
                if kind=="wdr2026-treatment":
                    ambiguous.add(row["id"]);audit["omittedRows"]+=1
                    continue
                raise ValueError("conflicting duplicate source grain: "+str(row))
            audit["identicalDuplicates"]+=1
            previous["sourceLocator"] += "; duplicate at "+row["sourceLocator"]
        else:seen[row["id"]]=row;out.append(row)
    audit["ambiguousGrains"]=len(ambiguous)
    audit["omittedRows"]+=len(ambiguous)
    out=[row for row in out if row["id"] not in ambiguous]
    return dict(indicators=sorted(indicators.values(),key=lambda x:x["id"]),observations=sorted(out,key=lambda x:x["id"]),audit=audit)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--input",required=True);p.add_argument("--kind",required=True);p.add_argument("--countries")
    p.add_argument("--related",nargs="*")
    args=p.parse_args()
    countries=json.loads(Path(args.countries).read_text()) if args.countries else None
    try:
        if args.kind=="country-map":
            out={}
            for f in [args.input]+(args.related or []):
                book=dict(sheets(f))
                sheet,codecol,namecol,start=("Seizures","A","D",3) if "Seizures" in book else (("Labs","D","C",2) if "Labs" in book else ("Sheet1","D","C",4))
                for rn,r in book[sheet]:
                    if rn<start or not r.get(codecol):continue
                    code=r[codecol];label=r[namecol].strip()
                    if not re.fullmatch(r"[A-Z]{3}",code):raise ValueError("country-map code invalid")
                    canonical=out.get(code,label);out[code]=canonical;out[label]=[code,canonical]
        elif args.kind=="sheet-arrays":
            out={}
            for name,rows in sheets(args.input):
                arr=[]
                for rn,cells in rows:
                    r=[]
                    for col,value in cells.items():
                        idx=0
                        for ch in col:idx=idx*26+ord(ch)-64
                        while len(r)<idx:r.append("")
                        # Only a syntactically numeric cell is converted; labels retain text.
                        r[idx-1]=number(value) if re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?",value or "") else value
                    while len(arr)<rn:arr.append([])
                    arr[rn-1]=r
                out[name]=arr
        else:out=normalize(args.input,args.kind,countries)
        json.dump(out,sys.stdout,ensure_ascii=False,allow_nan=False,separators=(",",":"))
    except (ValueError,KeyError,IndexError,zipfile.BadZipFile) as error:
        print("Drugs source rejected: "+str(error),file=sys.stderr);sys.exit(1)
