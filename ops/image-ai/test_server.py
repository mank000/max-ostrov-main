"""Cascade contract: uncertainty gates, verified anatomy and retryable outages."""
import io,json,unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
import server
class FakeSession:
    def __init__(self,explicit,reference=None):self.explicit=explicit;self.reference=explicit if reference is None else reference
    def get_inputs(self):return [type('Input',(),{'name':'images'})()]
    def run(self,*args):
        p=np.array([1-self.explicit,1e-9,1e-9,self.explicit/2,self.explicit/2])
        r=np.array([1-self.reference,1e-9,1e-9,self.reference/2,self.reference/2])
        return np.log(p)[None],np.zeros((1,5)),np.log(r)[None]
class CascadeContract(unittest.TestCase):
    def setUp(self):
        b=io.BytesIO();Image.new('RGB',(4,4)).save(b,format='PNG');self.data=b.getvalue()
        self.cfg={'preprocess':{},'review_thresholds':{'sexual_explicit':.437},'anatomy_cascade':{'classifier_min':.437,'classifier_max':.9,'version':'trusted','block_thresholds':{'FEMALE_BREAST_EXPOSED':.83}}}
    def infer(self,p,reference=None):
        with patch.object(server,'preprocess',return_value=np.zeros((3,4,4))):return server.analyze(self.data,self.cfg,FakeSession(p,reference))
    def test_clothed_low_score_does_not_call_anatomy(self):
        with patch.object(server.urllib.request,'urlopen') as call:
            self.assertEqual(self.infer(.2)['flags'],[]);call.assert_not_called()
    def test_confident_classifier_needs_no_second_call(self):
        with patch.object(server.urllib.request,'urlopen') as call:self.infer(.95);call.assert_not_called()
    def test_agreement_adds_explicit_flag(self):
        payload={'complete':True,'version':'trusted','scores':{'FEMALE_BREAST_EXPOSED':.9}}
        with patch.object(server.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
            self.assertIn('anatomical_nudity',self.infer(.5)['flags'])
    def test_reference_routes_low_primary_to_anatomy(self):
        payload={'complete':True,'version':'trusted','scores':{'FEMALE_BREAST_EXPOSED':.9}}
        with patch.object(server.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
            self.assertIn('anatomical_nudity',self.infer(.03,.6)['flags'])
    def test_reference_alone_cannot_review_clothed_image(self):
        payload={'complete':True,'version':'trusted','scores':{'FEMALE_BREAST_EXPOSED':0.}}
        with patch.object(server.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
            result=self.infer(.03,.85);self.assertEqual(result['flags'],[]);self.assertNotIn('sexual_explicit',result['review_flags'])
    def test_wrong_version_cannot_enforce(self):
        payload={'complete':True,'version':'other','scores':{'FEMALE_BREAST_EXPOSED':.99}}
        with patch.object(server.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
            with self.assertRaises(RuntimeError):self.infer(.5)
    def test_outage_is_retryable_not_invalid_image(self):
        with patch.object(server.urllib.request,'urlopen',side_effect=OSError('connection reset')):
            with self.assertRaises(RuntimeError):self.infer(.5)
if __name__=='__main__':unittest.main()
