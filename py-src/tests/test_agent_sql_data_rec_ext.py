# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import unittest
from unittest.mock import MagicMock, patch
import json

from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent 
# Assuming client_utils has these response objects or similar structures. Adjust if necessary.
# For this example, let's define simplified mock response classes if not easily importable or too complex.

class MockLLMResponseMessage:
    def __init__(self, role, content):
        self.role = role
        self.content = content

class MockLLMResponseChoice:
    def __init__(self, message_content):
        self.message = MockLLMResponseMessage(role="assistant", content=message_content)
        self.finish_reason = "stop"
        self.index = 0

class MockLLMRegularResponse:
    def __init__(self, message_content):
        self.choices = [MockLLMResponseChoice(message_content)]
        self.id="test_completion_id"
        self.created=0
        self.model="test_model"
        self.object="completion"
        self.system_fingerprint=None # Ensure all fields expected by the agent are present
        self.usage=None


class TestSQLDataRecAgentExt(unittest.TestCase):

    def setUp(self):
        # Mock the LLM client
        self.mock_llm_client = MagicMock()
        # Mock the database connection
        self.mock_db_conn = MagicMock()
        self.agent = SQLDataRecAgent(client=self.mock_llm_client, conn=self.mock_db_conn)

    def _create_mock_llm_response(self, response_content_str: str):
        """Helper to create a mock LLM response object using simplified mock classes."""
        return MockLLMRegularResponse(message_content=response_content_str)

    def test_broad_goal_multiple_suggestions(self):
        """
        Test Case 1: Broad Goal - Multiple Suggestions.
        Concept: Mock the LLM client's response to return a JSON with {"suggested_visualizations": [...]}
                 containing 2-3 valid visualization suggestions and a sample SQL query.
        Verification:
            - Verify that agent.run() correctly parses this mock response.
            - Check that the returned result contains the suggested_visualizations list with the expected number of items.
            - Check that each item in the list has the expected keys.
            - Verify that the SQL query is correctly extracted.
        """
        mock_json_response = {
            "suggested_visualizations": [
                {
                    "mode": "distribution",
                    "recommendation": "Shows distribution of sales.",
                    "output_fields": ["product_category", "total_sales"],
                    "chart_type": "bar",
                    "visualization_fields": ["product_category", "total_sales"]
                },
                {
                    "mode": "summary",
                    "recommendation": "Compares average price by region.",
                    "output_fields": ["region", "average_price"],
                    "chart_type": "line",
                    "visualization_fields": ["region", "average_price"]
                }
            ]
        }
        mock_sql_query = "SELECT product_category, SUM(sales) AS total_sales FROM sales_data GROUP BY product_category;"
        # Construct the LLM output string with JSON and SQL code blocks
        llm_output_string = f"```json\n{json.dumps(mock_json_response)}\n```\n\n```sql\n{mock_sql_query}\n```"

        self.mock_llm_client.get_completion.return_value = self._create_mock_llm_response(llm_output_string)
        
        # Mock DB execute for view creation and query (assuming these are called)
        self.mock_db_conn.execute.return_value.fetchone.return_value = (0,) # Mock row count for view
        self.mock_db_conn.execute.return_value.fetch_df.return_value = MagicMock() # Mock DataFrame result

        # Input for agent.run()
        input_tables_mock = [{"name": "sales_data", "description": "Table with sales information"}]
        description_mock = '{"goal": "Explore sales data"}' # Example broad goal

        results = self.agent.run(input_tables=input_tables_mock, description=description_mock)

        self.assertIsNotNone(results)
        self.assertGreater(len(results), 0, "Agent should return at least one candidate.")
        candidate = results[0]

        self.assertEqual(candidate['status'], 'ok')
        self.assertIn('suggested_visualizations', candidate)
        self.assertEqual(len(candidate['suggested_visualizations']), 2)

        first_suggestion = candidate['suggested_visualizations'][0]
        self.assertEqual(first_suggestion['chart_type'], 'bar')
        self.assertEqual(first_suggestion['visualization_fields'], ["product_category", "total_sales"])
        
        self.assertEqual(candidate['code'], mock_sql_query)

    def test_specific_goal_single_suggestion_as_list(self):
        """
        Test Case 2a: Specific Goal - Single Suggestion (as list).
        Concept: Mock LLM response with a single suggestion in the "suggested_visualizations" list.
        Verification: Agent processes it correctly, output list contains one item.
        """
        mock_json_response = {
            "suggested_visualizations": [
                {
                    "mode": "infer",
                    "recommendation": "Show sales over time.",
                    "output_fields": ["date", "total_sales"],
                    "chart_type": "line",
                    "visualization_fields": ["date", "total_sales"]
                }
            ]
        }
        mock_sql_query = "SELECT date, SUM(sales) AS total_sales FROM sales_data GROUP BY date ORDER BY date;"
        llm_output_string = f"```json\n{json.dumps(mock_json_response)}\n```\n```sql\n{mock_sql_query}\n```"
        self.mock_llm_client.get_completion.return_value = self._create_mock_llm_response(llm_output_string)
        self.mock_db_conn.execute.return_value.fetchone.return_value = (0,)
        self.mock_db_conn.execute.return_value.fetch_df.return_value = MagicMock()

        results = self.agent.run(input_tables=[{"name": "sales_data"}], description='{"goal": "Show sales trend"}')
        
        self.assertIsNotNone(results)
        self.assertGreater(len(results), 0)
        candidate = results[0]
        self.assertEqual(candidate['status'], 'ok')
        self.assertIn('suggested_visualizations', candidate)
        self.assertEqual(len(candidate['suggested_visualizations']), 1)
        self.assertEqual(candidate['suggested_visualizations'][0]['chart_type'], 'line')

    def test_specific_goal_single_suggestion_as_object(self):
        """
        Test Case 2b: Specific Goal - Single Suggestion (as old direct object for backward compatibility).
        Concept: Mock LLM response with a single suggestion as a direct JSON object (not in a list).
        Verification: Agent processes it by wrapping it in a list.
        """
        mock_json_response_direct_object = { # Old format (not wrapped in suggested_visualizations list)
            "mode": "infer",
            "recommendation": "Show count of items per category.",
            "output_fields": ["category", "item_count"],
            "chart_type": "bar",
            "visualization_fields": ["category", "item_count"]
        }
        mock_sql_query = "SELECT category, COUNT(item_id) AS item_count FROM items GROUP BY category;"
        llm_output_string = f"```json\n{json.dumps(mock_json_response_direct_object)}\n```\n```sql\n{mock_sql_query}\n```"
        self.mock_llm_client.get_completion.return_value = self._create_mock_llm_response(llm_output_string)
        self.mock_db_conn.execute.return_value.fetchone.return_value = (0,)
        self.mock_db_conn.execute.return_value.fetch_df.return_value = MagicMock()

        results = self.agent.run(input_tables=[{"name": "items"}], description='{"goal": "Count items per category"}')

        self.assertIsNotNone(results)
        self.assertGreater(len(results), 0)
        candidate = results[0]
        self.assertEqual(candidate['status'], 'ok')
        self.assertIn('suggested_visualizations', candidate)
        self.assertEqual(len(candidate['suggested_visualizations']), 1, "Should wrap direct object in a list")
        self.assertEqual(candidate['suggested_visualizations'][0]['chart_type'], 'bar')
        self.assertEqual(candidate['suggested_visualizations'][0]['mode'], 'infer')


    def test_malformed_llm_json_response(self):
        """
        Test Case 3: Malformed LLM Response (JSON).
        Concept: Mock the LLM client to return a malformed JSON.
        Verification: Ensure the agent handles this gracefully.
        """
        # Malformed JSON - missing closing brace for the first suggestion and for the list
        malformed_json_string = "```json\n{\"suggested_visualizations\": [{\"mode\": \"distribution\", \"recommendation\": \"Test\"}\n```\n```sql\nSELECT * FROM DUMMY;\n```"
        self.mock_llm_client.get_completion.return_value = self._create_mock_llm_response(malformed_json_string)
        # No need to mock DB if JSON parsing fails first, or if it's handled gracefully

        results = self.agent.run(input_tables=[{"name": "dummy_table"}], description='{"goal": "test malformed"}')
        
        self.assertIsNotNone(results)
        self.assertGreater(len(results), 0)
        candidate = results[0]
        
        # The agent's process_gpt_response has a fallback for when json_blocks is empty or parsing fails.
        # It creates a default structure for 'suggested_visualizations'.
        self.assertIn('suggested_visualizations', candidate)
        self.assertEqual(len(candidate['suggested_visualizations']), 1) # Fallback creates a single default item
        self.assertEqual(candidate['suggested_visualizations'][0]['recommendation'], "No JSON found in response")
        
        # SQL might still be extracted if it's outside the malformed JSON block and correctly formatted.
        self.assertEqual(candidate['code'], "SELECT * FROM DUMMY;")


    def test_no_sql_block_in_response(self):
        """
        Test Case: LLM Response without SQL block.
        Concept: Mock LLM response with valid JSON recommendations but no SQL block.
        Verification: Agent should handle this, result status might be 'error' or code might be empty.
        """
        mock_json_response = {
            "suggested_visualizations": [{"mode": "summary", "recommendation": "Test", "output_fields": ["a"], "chart_type": "bar", "visualization_fields": ["a"]}]
        }
        llm_output_string = f"```json\n{json.dumps(mock_json_response)}\n```" # No SQL block
        self.mock_llm_client.get_completion.return_value = self._create_mock_llm_response(llm_output_string)

        results = self.agent.run(input_tables=[{"name": "test_table"}], description='{"goal": "test no sql"}')

        self.assertIsNotNone(results)
        self.assertGreater(len(results), 0)
        candidate = results[0]
        self.assertEqual(candidate['status'], 'error') # Expecting error as no SQL code means cannot proceed
        self.assertEqual(candidate['code'], "")
        self.assertIn("No code block found", candidate['content'])
        # JSON part should still be processed
        self.assertEqual(len(candidate['suggested_visualizations']), 1)
        self.assertEqual(candidate['suggested_visualizations'][0]['mode'], 'summary')

if __name__ == '__main__':
    unittest.main()
