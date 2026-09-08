import importlib.util
import pathlib
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape

spec = importlib.util.spec_from_file_location("arms_economy_xlsx", pathlib.Path(__file__).with_name("arms-economy-xlsx.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(filename, cell, *, target="worksheets/sheet1.xml", external=False):
    with zipfile.ZipFile(filename, "w") as archive:
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="test" r:id="r1"/></sheets></workbook>')
        mode = ' TargetMode="External"' if external else ''
        archive.writestr("xl/_rels/workbook.xml.rels", f'<Relationships><Relationship Id="r1" Target="{target}"{mode}/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">{cell}</row></sheetData></worksheet>')


class WorkbookEvidenceTests(unittest.TestCase):
    def test_source_contradictions_are_excluded_and_identical_duplicates_deduplicated(self):
        headers = ["Iso3_code", "Country", "Region", "Subregion", "Indicator", "Dimension", "Category", "Sex", "Age", "Year", "Unit of measurement", "VALUE", "Source"]
        def row_values(year, value):
            return ["ALB", "Albania", "Europe", "Southern Europe", "Arms seized", "by location", "Total", "na", "na", year, "Counts", value, "IAFQ"]
        data = [[], [], headers, row_values("2018", "872"), row_values("2018", "862"), row_values("2019", "10"), row_values("2019", "10")]
        xml_rows = []
        for rownum, values in enumerate(data, 1):
            cells = ''.join(f'<c r="{chr(65+i)}{rownum}" t="inlineStr"><is><t>{escape(value)}</t></is></c>' for i, value in enumerate(values))
            xml_rows.append(f'<row r="{rownum}">{cells}</row>')
        with tempfile.TemporaryDirectory() as directory:
            filename = pathlib.Path(directory) / "test.xlsx"
            fixture(filename, '')
            with zipfile.ZipFile(filename) as original:
                members = {name: original.read(name) for name in original.namelist()}
            members['xl/worksheets/sheet1.xml'] = ('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(xml_rows) + '</sheetData></worksheet>').encode()
            with zipfile.ZipFile(filename, 'w') as archive:
                for name, value in members.items():
                    archive.writestr(name, value)
            result = module.normalize(filename, 'unodc-arms')
            self.assertEqual(result['summary']['ambiguousGrainsExcluded'], 1)
            self.assertEqual(result['summary']['duplicateIdenticalRows'], 1)
            self.assertEqual([(row['period'], row['value']) for row in result['observations']], [('2019', 10)])

    def test_missing_and_zero_are_distinct(self):
        self.assertIsNone(module.number(""))
        self.assertIsNone(module.number(None))
        self.assertEqual(module.number("0"), 0)

    def test_hostile_numeric_tokens(self):
        for value in [False, "n/a", "NaN", "inf", "10%", "1,234", float("inf")]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.number(value)

    def test_formula_never_executes(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = pathlib.Path(directory) / "test.xlsx"
            fixture(filename, '<c r="A1"><f>HYPERLINK("https://evil.test", "x")</f><v>999</v></c>')
            with self.assertRaisesRegex(ValueError, "formula"):
                list(module.sheets(filename))
            self.assertEqual(list(module.sheets(filename, skip_formula_rows=1))[0][1], [(1, {})])

    def test_external_sheet_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = pathlib.Path(directory) / "test.xlsx"
            fixture(filename, '<c r="A1"><v>1</v></c>', target="https://evil.test/x.xml", external=True)
            with self.assertRaisesRegex(ValueError, "external worksheet"):
                list(module.sheets(filename))

    def test_zip_traversal_is_rejected_without_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = pathlib.Path(directory) / "test.xlsx"
            with zipfile.ZipFile(filename, "w") as archive:
                archive.writestr("../escaped", "x")
            with self.assertRaisesRegex(ValueError, "unsafe ZIP path"):
                list(module.sheets(filename))
            self.assertFalse((pathlib.Path(directory).parent / "escaped").exists())

    def test_xml_entities_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "declarations"):
            module.parse_xml(b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')

    def test_subnational_policing_area_is_not_a_country(self):
        result = module.observation("x", "GBR_S", "United Kingdom (Scotland)", "2024", 0, "sheet!L4")
        self.assertEqual((result["geoCode"], result["geoLevel"]), ("GBR-SCT", "region"))

    def test_estimate_interval_bounds(self):
        with self.assertRaisesRegex(ValueError, "outside interval"):
            module.observation("x", "CHN", "China", "2024", 10, "sheet!A2", lower=0, upper=5)

    def test_identity_is_grain_not_value_or_position(self):
        first = module.observation("x", "CHN", "China", "2020", 10, "sheet!A2")
        changed = module.observation("x", "CHN", "China", "2020", 11, "sheet!A3")
        self.assertEqual(first["id"], changed["id"])


if __name__ == "__main__":
    unittest.main()
