import csv
import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('drugs',Path(__file__).with_name('drugs-workbooks.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DrugDataTests(unittest.TestCase):
    def statcan(self,flag='',value='12',lower='10',upper='14'):
        rows=[]
        for char,v in [('Load per capita (milligrams per one thousand people per day)',value),('Low 95% confidence interval, load per capita',lower),('High 95% confidence interval, load per capita',upper)]:
            rows.append(dict(REF_DATE='2023-01',GEO='Toronto, Ontario',Measure='Cocaine (Benzoylecgonine)',Characteristics=char,SCALAR_FACTOR='units',SCALAR_ID='0',VALUE=v,STATUS=flag,VECTOR='v1'))
        buf=io.StringIO();writer=csv.DictWriter(buf,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x.zip'
            with zipfile.ZipFile(p,'w') as z:z.writestr('13100871.csv',buf.getvalue());z.writestr('13100871_MetaData.csv','metadata')
            return m.normalize(p,'statcan-13100871')['observations']
    def test_estimate_interval_zero_and_flag(self):
        row=self.statcan('E')[0]
        self.assertEqual((row['value'],row['lower'],row['upper'],row['period']),(12,10,14,'2023-01'))
        self.assertIn('quality=E',row['sourceLocator'])
        self.assertEqual(self.statcan(value='0',lower='0',upper='2')[0]['value'],0)
    def test_suppressed_not_zero_or_numeric_bounds(self):
        row=self.statcan('F',value='')[0]
        self.assertEqual((row['value'],row['lower'],row['upper'],row['status']),(None,None,None,'unavailable'))
    def test_reversed_interval_rejected(self):
        with self.assertRaises(ValueError):self.statcan(lower='13')
    def test_unknown_quality_flag_rejected(self):
        with self.assertRaises(ValueError):self.statcan('UNREVIEWED')
    def test_conflicting_treatment_counts_and_nonannual_years_excluded(self):
        header={'C':'Country','D':'msCode','E':'Reference year','G':'Drug','H':'Sex','I':'value'}
        base={'C':'Kenya','D':'KEN','E':'2024','G':'Heroin','H':'Females','F':'Opioids'}
        rows=[(3,header),(4,{**base,'I':'10'}),(5,{**base,'I':'12'}),(6,{**base,'E':'Other','I':'100'}),(7,{**base,'H':'Males','I':'0'})]
        with patch.object(m,'sheets',return_value=[('Sheet1',rows)]):d=m.normalize('unused','wdr2026-treatment')
        self.assertEqual(len(d['observations']),1);self.assertEqual(d['observations'][0]['value'],0)
        self.assertEqual(d['audit']['ambiguousGrains'],1);self.assertEqual(d['audit']['omittedRows'],3)
    def test_dangerous_zip_paths_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x.zip'
            with zipfile.ZipFile(p,'w') as z:z.writestr('../13100871.csv','x');z.writestr('13100871_MetaData.csv','x')
            with self.assertRaises(ValueError):m.normalize(p,'statcan-13100871')
    def test_doc_label_requires_corresponding_official_footnote(self):
        clean='2,5-Dimethoxy-4-chloroamphetamine (DOC)'
        header={'A':'Iso3_code','D':'Country','G':'DrugName','H':'Reference year','I':'Kilograms'}
        row={'A':'NOR','D':'Norway','G':clean+'\t 0.06','H':'2015','I':'0.001965','K':clean}
        with patch.object(m,'sheets',return_value=[('Seizures',[(2,header),(3,row)])]):data=m.normalize('unused','wdr2026-seizures')
        self.assertEqual(data['observations'][0]['category'],clean)
        self.assertEqual(data['observations'][0]['value'],0.001965)
        self.assertIn('0.06',data['observations'][0]['sourceLocator'])
        row['K']='unverified'
        with patch.object(m,'sheets',return_value=[('Seizures',[(2,header),(3,row)])]):
            with self.assertRaises(ValueError):m.normalize('unused','wdr2026-seizures')

if __name__=='__main__':unittest.main()
