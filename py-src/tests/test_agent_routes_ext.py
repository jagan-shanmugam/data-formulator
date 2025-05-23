# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import unittest
from unittest.mock import patch, MagicMock
import json
from flask import Flask, session 

# Assuming your Flask app instance is created in a way that can be imported or accessed
# from data_formulator.main import app as flask_app # Adjust if your app instance is named differently or located elsewhere

from data_formulator.agent_routes import agent_bp 
from data_formulator.db_manager import db_manager 

class TestAgentRoutesAutoDashboard(unittest.TestCase):

    def setUp(self):
        self.app = Flask(__name__)
        self.app.secret_key = 'test_secret_key' 
        self.app.register_blueprint(agent_bp)
        self.client = self.app.test_client()

        # Patch db_manager to prevent actual DB calls during tests
        self.db_manager_patch = patch('data_formulator.agent_routes.db_manager', spec=db_manager)
        self.mock_db_manager = self.db_manager_patch.start()
        self.mock_db_conn = MagicMock()
        self.mock_db_manager.get_connection.return_value = self.mock_db_conn


    def tearDown(self):
        self.db_manager_patch.stop()


    @patch('data_formulator.agent_routes.SQLDataRecAgent') 
    @patch('data_formulator.agent_routes.get_client') 
    def test_auto_dashboard_success(self, mock_get_client, mock_SQLDataRecAgent_class):
        """
        Test Case 1: Successful /api/auto_dashboard call.
        """
        # Mock the LLM client instance returned by get_client
        mock_llm_client_instance = MagicMock()
        mock_get_client.return_value = mock_llm_client_instance

        # Mock the SQLDataRecAgent instance and its run method
        mock_agent_instance = MagicMock()
        mock_SQLDataRecAgent_class.return_value = mock_agent_instance
        
        mock_successful_agent_response = [
            {
                "status": "ok",
                "code": "SELECT column_a, COUNT(*) FROM test_table GROUP BY column_a;",
                "content": {"rows": [{"column_a": "val1", "COUNT(*)": 10}], "virtual": {"table_name": "view_xyz", "row_count": 1}}, # Mocked data_content
                "suggested_visualizations": [
                    {"chart_type": "bar", "visualization_fields": ["column_a", "COUNT(*)"], "recommendation": "Bar chart"}
                ],
                "dialog": [] # Add if your actual response includes this
            }
        ]
        mock_agent_instance.run.return_value = mock_successful_agent_response

        # Simulate an active session as the route uses session.get('session_id', ...)
        with self.client.session_transaction() as sess:
            sess['session_id'] = 'test_session_id_for_auto_dashboard'

        response = self.client.post('/api/agent/auto_dashboard',
                                    data=json.dumps({
                                        "table_name": "test_table",
                                        "model": {"id": "test-model", "endpoint": "test-endpoint", "model": "gpt-test"} # Provide necessary model config
                                    }),
                                    content_type='application/json')

        self.assertEqual(response.status_code, 200, f"Response data: {response.data.decode()}")
        response_data = json.loads(response.data)
        self.assertEqual(response_data['status'], 'ok')
        self.assertIn('results', response_data)
        results = response_data['results']
        self.assertEqual(results['sql_query'], mock_successful_agent_response[0]['code'])
        self.assertEqual(results['data_content'], mock_successful_agent_response[0]['content'])
        self.assertEqual(len(results['dashboard_suggestions']), 1)
        self.assertEqual(results['dashboard_suggestions'][0]['chart_type'], 'bar')


    @patch('data_formulator.agent_routes.SQLDataRecAgent')
    @patch('data_formulator.agent_routes.get_client')
    def test_auto_dashboard_agent_error(self, mock_get_client, mock_SQLDataRecAgent_class):
        """
        Test Case 2: API Call with Agent Error.
        """
        mock_get_client.return_value = MagicMock() # Mock LLM client
        mock_agent_instance = MagicMock()
        mock_SQLDataRecAgent_class.return_value = mock_agent_instance

        mock_error_agent_response = [
            {
                "status": "error",
                "content": "Agent failed due to internal error.",
                "code": "",
                "suggested_visualizations": [], # or None, depending on agent's error contract
                "dialog": []
            }
        ]
        mock_agent_instance.run.return_value = mock_error_agent_response
        
        with self.client.session_transaction() as sess:
            sess['session_id'] = 'test_session_id_agent_error'

        response = self.client.post('/api/agent/auto_dashboard',
                                    data=json.dumps({
                                        "table_name": "error_table",
                                        "model": {"id": "test-model", "endpoint": "test-endpoint", "model": "gpt-test"}
                                    }),
                                    content_type='application/json')

        self.assertEqual(response.status_code, 500) # As per current route logic for agent errors
        response_data = json.loads(response.data)
        self.assertEqual(response_data['status'], 'error')
        self.assertIn('Agent failed', response_data['message'])
        self.assertEqual(response_data['detail'], "Agent failed due to internal error.")


    def test_auto_dashboard_invalid_input_missing_table(self):
        """
        Test Case 3a: API Call with Invalid Input (missing table_name).
        """
        with self.client.session_transaction() as sess:
            sess['session_id'] = 'test_session_id_missing_table'

        response = self.client.post('/api/agent/auto_dashboard',
                                    data=json.dumps({
                                        # "table_name": "test_table", # Missing
                                        "model": {"id": "test-model", "endpoint": "test-endpoint", "model": "gpt-test"}
                                    }),
                                    content_type='application/json')

        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.data)
        self.assertEqual(response_data['status'], 'error')
        self.assertIn("Missing 'table_name'", response_data['message'])

    def test_auto_dashboard_invalid_input_missing_model(self):
        """
        Test Case 3b: API Call with Invalid Input (missing model).
        """
        with self.client.session_transaction() as sess:
            sess['session_id'] = 'test_session_id_missing_model'

        response = self.client.post('/api/agent/auto_dashboard',
                                    data=json.dumps({"table_name": "test_table"}), # Missing model
                                    content_type='application/json')

        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.data)
        self.assertEqual(response_data['status'], 'error')
        self.assertIn("Missing 'model' configuration", response_data['message'])

    @patch('data_formulator.agent_routes.SQLDataRecAgent')
    @patch('data_formulator.agent_routes.get_client')
    def test_auto_dashboard_agent_returns_no_candidates(self, mock_get_client, mock_SQLDataRecAgent_class):
        """
        Test Case: Agent returns no candidates.
        Concept: Mock SQLDataRecAgent.run() to return an empty list.
        Verification: Assert HTTP 500 and appropriate error message.
        """
        mock_get_client.return_value = MagicMock()
        mock_agent_instance = MagicMock()
        mock_SQLDataRecAgent_class.return_value = mock_agent_instance
        mock_agent_instance.run.return_value = [] # Agent returns no candidates

        with self.client.session_transaction() as sess:
            sess['session_id'] = 'test_session_no_candidates'

        response = self.client.post('/api/agent/auto_dashboard',
                                    data=json.dumps({
                                        "table_name": "no_candidate_table",
                                        "model": {"id": "test-model", "endpoint": "test-endpoint", "model": "gpt-test"}
                                    }),
                                    content_type='application/json')

        self.assertEqual(response.status_code, 500)
        response_data = json.loads(response.data)
        self.assertEqual(response_data['status'], 'error')
        self.assertEqual(response_data['message'], "Agent returned no candidates.")

if __name__ == '__main__':
    unittest.main()
