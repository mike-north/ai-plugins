"""Tests encode isolation, evidence integrity and truthful coverage before the runner exists."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).with_name('harness.py')
spec = importlib.util.spec_from_file_location('harness', MODULE)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

class HarnessContract(unittest.TestCase):
    """A harness must not turn malformed inputs or missing evidence into success."""
    def test_paths_remain_inside_case(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in ('../secret', '/tmp/secret', 'a/../../secret', '.git/config'):
                with self.assertRaises(ValueError):
                    harness.safe_path(root, path)
            self.assertEqual(harness.safe_path(root, 'docs/plan.md'), root/'docs/plan.md')

    def test_symlink_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'link').symlink_to('/tmp', target_is_directory=True)
            with self.assertRaises(ValueError):
                harness.safe_path(root, 'link/secret')

    def test_only_completed_usage_counts_and_missing_is_null(self):
        self.assertIsNone(harness.metrics([])['usage'])
        result = harness.metrics([{'type':'turn.completed','usage':{'input_tokens':10,'output_tokens':4}},
                                  {'type':'item.started','item':{'type':'command_execution'}},
                                  {'type':'item.completed','item':{'type':'command_execution'}}])
        self.assertEqual(result['usage']['output_tokens'], 4)
        self.assertEqual(result['commands'], 1)

    def test_corrupt_trace_is_not_silently_ignored(self):
        with self.assertRaises(ValueError):
            harness.parse_events('{"type":"turn.started"}\ncorrupt')

    def test_hidden_grader_is_not_in_prompt(self):
        case = {'id':'x','kind':'behavior','capabilities':'markdown-only','files':{},
                'stages':[{'prompt':'Review this.'}],'skills':[]}
        prompt = harness.subject_prompt(case, 0, Path('/tmp/example'), '')
        self.assertNotIn('outcomes', prompt)
        self.assertIn('zero tool calls', prompt)

    def test_files_are_checked_by_content_not_claims(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'plan.md').write_text('changed')
            checks=harness.check_files(root, {'plan.md':'original'},
                [{'kind':'unchanged','path':'plan.md'}, {'kind':'exists','path':'missing.md'}])
            self.assertEqual([c['passed'] for c in checks], [False,False])

    def test_missing_stage_does_not_mean_complete(self):
        self.assertEqual(harness.coverage_status([], 2), 'UNRUN')
        self.assertEqual(harness.coverage_status([{'status':'COMPLETE'}], 2), 'PARTIAL')
        self.assertEqual(harness.coverage_status([{'status':'BLOCKED'}], 2), 'BLOCKED')
        self.assertEqual(harness.coverage_status([{'status':'COMPLETE'}]*2, 2), 'COMPLETE')

    def test_fixture_reset_does_not_reuse_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'fixture'
            harness.materialize(root, {'plan.md':'first'})
            with self.assertRaises(FileExistsError):
                harness.materialize(root, {'plan.md':'second'})
            self.assertEqual((root/'plan.md').read_text(), 'first')

    def test_fixture_creation_and_updates_reject_collisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'fixture'
            with self.assertRaises(ValueError):
                harness.materialize(root, {'_guidance/SKILL.md':'spoof'})


class GradeEvidenceContract(unittest.TestCase):
    """Qualitative scores need inspectable evidence and complete per-candidate outcomes."""
    def test_grade_rejects_unsubstantiated_score(self):
        with self.assertRaises(ValueError):
            harness.validate_grade({'winner':'A','grades':[]}, {'dimensions':['authority'],'outcomes':['preserve choice']})

    def test_completed_process_without_response_is_invalid(self):
        self.assertFalse(harness.valid_completion([{'type':'turn.completed'}], ''))
        self.assertTrue(harness.valid_completion([{'type':'turn.completed'}], 'Review result'))

class ComparisonSummaryContract(unittest.TestCase):
    """Comparisons preserve dimension variation and do not turn unknown usage into zero."""
    def test_variance_retains_repetition_count(self):
        result=harness.summarize_values([1,3])
        self.assertEqual(result['n'],2)
        self.assertEqual(result['mean'],2)
        self.assertEqual(result['min'],1)
        self.assertEqual(result['max'],3)
        self.assertGreater(result['sample_stdev'],0)

    def test_one_sample_has_no_estimated_variance(self):
        self.assertIsNone(harness.summarize_values([3])['sample_stdev'])
        self.assertIsNone(harness.summarize_values([])['mean'])

class RegressionIntegrityContract(unittest.TestCase):
    """Execution validity and allocation identity must survive interrupted and expanded experiments."""
    def test_only_complete_chains_are_pairable(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'summary.json').write_text(json.dumps({'status':'PARTIAL'}))
            self.assertFalse(harness.pairable(root))
            (root/'summary.json').write_text(json.dumps({'status':'COMPLETE','stages':[{'capability_violation':True}]}))
            self.assertFalse(harness.pairable(root))
            (root/'summary.json').write_text(json.dumps({'status':'COMPLETE','stages':[{}]}))
            self.assertTrue(harness.pairable(root))

    def test_duplicate_outcomes_and_boolean_scores_are_invalid(self):
        outcome={'criterion':'first','verdict':'pass','evidence':'file: actual fact'}
        candidate={'label':'A','dimensions':{'authority':{'score':2,'evidence':['file: actual fact']}},
            'outcomes':[outcome,outcome], 'authority_errors':[], 'false_alarms':[],
            'missed_issues':[], 'unnecessary_detours':[], 'limitations':[]}
        other=dict(candidate,label='B')
        with self.assertRaises(ValueError):
            harness.validate_grade({'winner':'tie','grades':[candidate,other]}, {'dimensions':['authority'],'outcomes':['first','second']})
        candidate['outcomes']=[outcome]
        other['outcomes']=[outcome]
        candidate['dimensions']['authority']['score']=True
        with self.assertRaises(ValueError):
            harness.validate_grade({'winner':'tie','grades':[candidate,other]}, {'dimensions':['authority'],'outcomes':['first']})

    def test_merging_allocation_preserves_old_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'mapping.json'
            harness.merge_allocation(file,{'old':{'A':'none'}})
            harness.merge_allocation(file,{'new':{'A':'prior'}})
            self.assertEqual(set(json.loads(file.read_text())),{'old','new'})
            with self.assertRaises(ValueError):
                harness.merge_allocation(file,{'old':{'A':'prior'}})

class SnapshotIntegrityContract(unittest.TestCase):
    """A frozen intervention includes its complete file set, not only previously existing bytes."""
    def test_new_guidance_cannot_bypass_hash_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'guidance/current').mkdir(parents=True)
            (root/'manifest.json').write_text(json.dumps({'files':{}}))
            (root/'guidance/current/new.md').write_text('new intervention')
            with self.assertRaises(ValueError):
                harness.verify_snapshot(root)


class BlindIdentityContract(unittest.TestCase):
    """Anonymized artifacts must not disclose allocation through absolute workspace links."""
    def test_plain_and_url_encoded_run_paths_are_anonymous(self):
        root=Path('/tmp/task space/runs/c01/current/repeat-1')
        value='Read /tmp/task space/runs/c01/current/repeat-1/workspace/docs/a.md and /tmp/task%20space/runs/c01/current/repeat-1/workspace/docs/b.md. current release remains.'
        result=harness.anonymize(value,root)
        self.assertNotIn('/current/',result)
        self.assertIn('current release remains',result)
        self.assertIn('candidate/workspace/docs/a.md',result)


class RepositoryBoundaryContract(unittest.TestCase):
    """Disposable fixtures must terminate Git discovery before parent repository metadata leaks."""
    def test_repository_root_is_fixture_and_no_commit_is_created(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'workspace'
            root.mkdir()
            harness.isolate_repository(root)
            top=subprocess.run(['git','rev-parse','--show-toplevel'],cwd=root,capture_output=True,text=True,check=True)
            self.assertEqual(Path(top.stdout.strip()).resolve(),root.resolve())
            head=subprocess.run(['git','rev-parse','--verify','HEAD'],cwd=root,capture_output=True)
            self.assertNotEqual(head.returncode,0)


class JudgmentIdentityContract(unittest.TestCase):
    """Repeated judgments of one subject are not independent subject repetitions."""
    def test_different_baselines_do_not_inflate_repetition_count(self):
        records=[{'source':'runs/c01/current/repeat-1','baseline':'none','dimension':'authority','score':1},
                 {'source':'runs/c01/current/repeat-1','baseline':'prior','dimension':'authority','score':3}]
        groups=harness.dimension_summaries(records)
        self.assertEqual(len(groups),2)
        self.assertTrue(all(item['n']==1 and item['sample_stdev'] is None for item in groups))

    def test_grade_rejects_extra_dimensions(self):
        outcome={'criterion':'first','verdict':'pass','evidence':'file: actual fact'}
        candidate={'label':'A','dimensions':{'authority':{'score':2,'evidence':['file: actual fact']},'invented':{'score':100}},
            'outcomes':[outcome], 'authority_errors':[], 'false_alarms':[],
            'missed_issues':[], 'unnecessary_detours':[], 'limitations':[]}
        with self.assertRaises(ValueError):
            harness.validate_grade({'winner':'tie','grades':[candidate,dict(candidate,label='B')]}, {'dimensions':['authority'],'outcomes':['first']})


class CapabilityAttemptContract(unittest.TestCase):
    """A forbidden tool attempt matters even when the host never emits its completion event."""
    def test_incomplete_tool_attempt_is_not_reported_as_zero(self):
        result=harness.metrics([{'type':'item.started','item':{'id':'tool-1','type':'command_execution'}}])
        self.assertEqual(result['tool_attempts'],1)
        completed=harness.metrics([{'type':'item.started','item':{'id':'tool-1','type':'command_execution'}},
                                   {'type':'item.completed','item':{'id':'tool-1','type':'command_execution'}}])
        self.assertEqual(completed['tool_attempts'],1)


class ViewerExportContract(unittest.TestCase):
    """The reference viewer receives completed outputs and provenance, never invented pass rates."""
    def test_export_excludes_unfinished_runs_and_preserves_stage_outputs(self):
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'run'
            root.mkdir()
            corpus={'cases':[{'id':'x','stages':[{'prompt':'Review'}]}]}
            harness.dump(root/'corpus.json',corpus)
            harness.dump(root/'manifest.json',{'files':{}})
            complete=root/'runs/x/current/repeat-1'
            stage=complete/'stage-1'
            stage.mkdir(parents=True)
            (stage/'response.md').write_text('A concrete review')
            harness.dump(stage/'after.json',{'docs/a.md':'actual saved artifact'})
            harness.dump(complete/'summary.json',{'status':'COMPLETE','stages':[{}]})
            blocked=root/'runs/x/none/repeat-1'
            blocked.mkdir(parents=True)
            harness.dump(blocked/'summary.json',{'status':'BLOCKED','stages':[]})
            output=Path(directory)/'viewer'
            harness.export_viewer(Namespace(run=str(root),output=str(output)))
            self.assertTrue((output/'x/current/repeat-1/outputs/stage-1.response.md').exists())
            self.assertEqual((output/'x/current/repeat-1/outputs/stage-1.file-001.a.md').read_text(), 'actual saved artifact')
            self.assertFalse((output/'x/none').exists())
            self.assertFalse((output/'benchmark.json').exists())

if __name__ == '__main__':
    unittest.main()
