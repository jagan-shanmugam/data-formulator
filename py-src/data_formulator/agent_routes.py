# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import random
import sys
import os
import mimetypes
import re
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')

import flask
from flask import request, session, jsonify, Blueprint, current_app
import logging

import json
import html
import traceback

from data_formulator.agents.agent_concept_derive import ConceptDeriveAgent
from data_formulator.agents.agent_py_concept_derive import PyConceptDeriveAgent

from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.agent_sql_data_transform import SQLDataTransformationAgent
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent

from data_formulator.agents.agent_sort_data import SortDataAgent
from data_formulator.agents.agent_data_load import DataLoadAgent
from data_formulator.agents.agent_data_clean import DataCleanAgent
from data_formulator.agents.agent_code_explanation import CodeExplanationAgent
from data_formulator.agents.agent_query_completion import QueryCompletionAgent
from data_formulator.agents.client_utils import Client

from data_formulator.db_manager import db_manager

# Configure root logger for general application logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# Get logger for this module
logger = logging.getLogger(__name__)

agent_bp = Blueprint('agent', __name__, url_prefix='/api/agent')

def get_client(model_config):
    for key in model_config:
        model_config[key] = model_config[key].strip()

    client = Client(
        model_config["endpoint"],
        model_config["model"],
        model_config["api_key"] if "api_key" in model_config else None,
        html.escape(model_config["api_base"]) if "api_base" in model_config else None,
        model_config["api_version"] if "api_version" in model_config else None)

    return client


@agent_bp.route('/check-available-models', methods=['GET', 'POST'])
def check_available_models():
    results = []
    
    # Define configurations for different providers
    providers = ['openai', 'azure', 'anthropic', 'gemini', 'ollama']

    for provider in providers:
        # Skip if provider is not enabled
        if not os.getenv(f"{provider.upper()}_ENABLED", "").lower() == "true":
            continue
        
        api_key = os.getenv(f"{provider.upper()}_API_KEY", "")
        api_base = os.getenv(f"{provider.upper()}_API_BASE", "")
        api_version = os.getenv(f"{provider.upper()}_API_VERSION", "")
        models = os.getenv(f"{provider.upper()}_MODELS", "")

        if not (api_key or api_base):
            continue

        if not models:
            continue

        # Build config for each model
        for model in models.split(","):
            model = model.strip()
            if not model:
                continue

            model_config = {
                "id": f"{provider}-{model}-{api_key}-{api_base}-{api_version}",
                "endpoint": provider,
                "model": model,
                "api_key": api_key,
                "api_base": api_base,
                "api_version": api_version
            }
            
            try:
                client = get_client(model_config)
                response = client.get_completion(
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": "Respond 'I can hear you.' if you can hear me."},
                    ]
                )
                
                if "I can hear you." in response.choices[0].message.content:
                    results.append(model_config)
            except Exception as e:
                print(f"Error testing {provider} model {model}: {e}")
                
    return json.dumps(results)

def sanitize_model_error(error_message: str) -> str:
    """Sanitize model API error messages before sending to client."""
    # HTML escape the message
    message = html.escape(error_message)
    
    # Remove any potential API keys that might be in the error
    message = re.sub(r'(api[-_]?key|api[-_]?token)[=:]\s*[^\s&]+', r'\1=<redacted>', message, flags=re.IGNORECASE)
    
    # Keep only the essential error info
    if len(message) > 500:  # Truncate very long messages
        message = message[:500] + "..."
        
    return message

@agent_bp.route('/test-model', methods=['GET', 'POST'])
def test_model():
    if request.is_json:
        logger.info("# code query: ")
        content = request.get_json()

        # contains endpoint, key, model, api_base, api_version
        logger.info("content------------------------------")
        logger.info(content)

        client = get_client(content['model'])
        
        try:
            response = client.get_completion(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me. Do not say anything other than 'I can hear you.'"},
                ]
            )

            logger.info(f"model: {content['model']}")
            logger.info(f"welcome message: {response.choices[0].message.content}")

            if "I can hear you." in response.choices[0].message.content:
                result = {
                    "model": content['model'],
                    "status": 'ok',
                    "message": ""
                }
        except Exception as e:
            print(f"Error: {e}")
            logger.info(f"Error: {e}")
            result = {
                "model": content['model'],
                "status": 'error',
                "message": sanitize_model_error(str(e)),
            }
    else:
        result = {'status': 'error'}
    
    return json.dumps(result)

@agent_bp.route('/process-data-on-load', methods=['GET', 'POST'])
def process_data_on_load_request():

    if request.is_json:
        logger.info("# process data query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")

        conn = db_manager.get_connection(session['session_id'])
        agent = DataLoadAgent(client=client, conn=conn)
        
        candidates = agent.run(content["input_data"])
        
        candidates = [c['content'] for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/auto_dashboard', methods=['POST'])
def auto_dashboard_request():
    if not request.is_json:
        return jsonify({"status": "error", "message": "Request must be JSON"}), 400

    content = request.get_json()
    token = content.get("token", "") # Optional token
    table_name = content.get("table_name")
    model_config = content.get("model")

    if not table_name:
        return jsonify({"status": "error", "message": "Missing 'table_name' in request"}), 400
    
    if not model_config:
        return jsonify({"status": "error", "message": "Missing 'model' configuration in request"}), 400

    client = None
    conn = None
    try:
        client = get_client(model_config)
        conn = db_manager.get_connection(session.get('session_id', 'default_session')) # Use default if no session

        agent = SQLDataRecAgent(client=client, conn=conn)

        generic_goal_json_string = """
{
    "goal": "Analyze the provided dataset. Identify key characteristics, distributions, and potential relationships within the data. Suggest a diverse set of 3-5 distinct visualizations that would provide a good initial overview for a user unfamiliar with this dataset. For each visualization, specify the chart type, the fields to be visualized, and the reasoning for your recommendation."
}
"""
        input_tables = [{"name": table_name, "description": "Dataset for auto dashboard generation"}]
        
        logger.info(f"Requesting auto dashboard for table: {table_name} with model: {model_config.get('model')}")

        # The agent.run() method returns a list of candidates
        candidates = agent.run(input_tables=input_tables, description=generic_goal_json_string)

        if candidates and candidates[0]['status'] == 'ok':
            candidate = candidates[0]
            response_data = {
                "sql_query": candidate.get('code'),
                "data_content": candidate.get('content'),
                "dashboard_suggestions": candidate.get('suggested_visualizations', []) # Ensure key exists
            }
            return jsonify({"token": token, "status": "ok", "results": response_data})
        elif candidates:
            error_detail = candidates[0].get('content', 'Agent returned an error without specific content.')
            logger.error(f"Agent failed for auto_dashboard: {error_detail}")
            return jsonify({"token": token, "status": "error", "message": "Agent failed to generate dashboard suggestions.", "detail": error_detail}), 500
        else:
            logger.error("Agent returned no candidates for auto_dashboard.")
            return jsonify({"token": token, "status": "error", "message": "Agent returned no candidates."}), 500

    except Exception as e:
        logger.error(f"Exception in /auto_dashboard: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({"token": token, "status": "error", "message": f"An unexpected error occurred: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed for /auto_dashboard.")

    # This part should ideally not be reached if logic is correct, but as a fallback:
    return jsonify({"token": token, "status": "error", "message": "An unknown error occurred in auto_dashboard endpoint."}), 500
    # The above return should be inside the try or except block.
    # This line is a placeholder and should not be reached if the logic above is complete.
    # However, to satisfy the structure, ensure all paths return a Flask response.
    # Fallback, though ideally not reached:
    # return jsonify({"status": "error", "message": "Reached end of function unexpectedly"}), 500
    # Actually, the structure implies the final return is part of the function, not the finally block.
    # The previous structure was fine. Let's remove the redundant part.
    # This part should ideally not be reached if logic is correct, but as a fallback:
    return jsonify({"token": token, "status": "error", "message": "An unknown error occurred in auto_dashboard endpoint."}), 500


@agent_bp.route('/derive-concept-request', methods=['GET', 'POST'])
def derive_concept_request():

    if request.is_json:
        logger.info("# code query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")
        agent = ConceptDeriveAgent(client=client)

        #print(content["input_data"])

        candidates = agent.run(content["input_data"], [f['name'] for f in content["input_fields"]], 
                                       content["output_name"], content["description"])
        
        candidates = [c['code'] for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/derive-py-concept', methods=['GET', 'POST'])
def derive_py_concept():

    if request.is_json:
        logger.info("# code query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")
        agent = PyConceptDeriveAgent(client=client)

        #print(content["input_data"])

        results = agent.run(content["input_data"], [f['name'] for f in content["input_fields"]], 
                                       content["output_name"], content["description"])
        
        response = flask.jsonify({ "status": "ok", "token": token, "results": results })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "results": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/clean-data', methods=['GET', 'POST'])
def clean_data_request():

    if request.is_json:
        logger.info("# data clean request")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        logger.info(f" model: {content['model']}")
        
        agent = DataCleanAgent(client=client)

        candidates = agent.run(content['content_type'], content["raw_data"], content["image_cleaning_instruction"])
        
        candidates = [c for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@agent_bp.route('/sort-data', methods=['GET', 'POST'])
def sort_data_request():

    if request.is_json:
        logger.info("# sort query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        agent = SortDataAgent(client=client)
        candidates = agent.run(content['field'], content['items'])

        candidates = candidates if candidates != None else []
        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/derive-data', methods=['GET', 'POST'])
def derive_data():

    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]

        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        new_fields = content["new_fields"]
        instruction = content["extra_prompt"]
        language = content.get("language", "python") # whether to use sql or python, default to python
        
        max_repair_attempts = content["max_repair_attempts"] if "max_repair_attempts" in content else 1

        if "additional_messages" in content:
            prev_messages = content["additional_messages"]
        else:
            prev_messages = []

        logger.info("== input tables ===>")
        for table in input_tables:
            logger.info(f"===> Table: {table['name']} (first 5 rows)")
            logger.info(table['rows'][:5])

        logger.info("== user spec ===")
        logger.info(new_fields)
        logger.info(instruction)

        mode = "transform"
        if len(new_fields) == 0:
            mode = "recommendation"

        conn = db_manager.get_connection(session['session_id']) if language == "sql" else None

        if mode == "recommendation":
            # now it's in recommendation mode
            agent = SQLDataRecAgent(client=client, conn=conn) if language == "sql" else PythonDataRecAgent(client=client, exec_python_in_subprocess=current_app.config['CLI_ARGS']['exec_python_in_subprocess'])
            results = agent.run(input_tables, instruction)
        else:
            agent = SQLDataTransformationAgent(client=client, conn=conn) if language == "sql" else PythonDataTransformationAgent(client=client, exec_python_in_subprocess=current_app.config['CLI_ARGS']['exec_python_in_subprocess'])
            results = agent.run(input_tables, instruction, [field['name'] for field in new_fields], prev_messages)

        repair_attempts = 0
        while results[0]['status'] == 'error' and repair_attempts < max_repair_attempts: # try up to n times
            error_message = results[0]['content']
            new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."

            prev_dialog = results[0]['dialog']

            if mode == "transform":
                results = agent.followup(input_tables, prev_dialog, [field['name'] for field in new_fields], new_instruction)
            if mode == "recommendation":
                results = agent.followup(input_tables, prev_dialog, new_instruction)

            repair_attempts += 1
        
        if conn:
            conn.close()
        
        response = flask.jsonify({ "token": token, "status": "ok", "results": results })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/refine-data', methods=['GET', 'POST'])
def refine_data():

    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]


        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        output_fields = content["output_fields"]
        dialog = content["dialog"]
        new_instruction = content["new_instruction"]
        max_repair_attempts = content.get("max_repair_attempts", 1)
        language = content.get("language", "python") # whether to use sql or python, default to python

        logger.info("== input tables ===>")
        for table in input_tables:
            logger.info(f"===> Table: {table['name']} (first 5 rows)")
            logger.info(table['rows'][:5])
        
        logger.info("== user spec ===>")
        logger.info(output_fields)
        logger.info(new_instruction)

        conn = db_manager.get_connection(session['session_id']) if language == "sql" else None

        # always resort to the data transform agent       
        agent = SQLDataTransformationAgent(client=client, conn=conn) if language == "sql" else PythonDataTransformationAgent(client=client, exec_python_in_subprocess=current_app.config['CLI_ARGS']['exec_python_in_subprocess'])
        results = agent.followup(input_tables, dialog, [field['name'] for field in output_fields], new_instruction)

        repair_attempts = 0
        while results[0]['status'] == 'error' and repair_attempts < max_repair_attempts: # only try once
            error_message = results[0]['content']
            new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."
            prev_dialog = results[0]['dialog']

            results = agent.followup(input_tables, prev_dialog, [field['name'] for field in output_fields], new_instruction)
            repair_attempts += 1

        if conn:
            conn.close()

        response = flask.jsonify({ "token": token, "status": "ok", "results": results})
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": []})

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@agent_bp.route('/code-expl', methods=['GET', 'POST'])
def request_code_expl():
    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]

        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        code = content["code"]
        
        code_expl_agent = CodeExplanationAgent(client=client)
        expl = code_expl_agent.run(input_tables, code)
    else:
        expl = ""
    return expl

@agent_bp.route('/query-completion', methods=['POST'])
def query_completion():
    if request.is_json:
        logger.info("# request data: ")
        content = request.get_json()        

        client = get_client(content['model'])

        data_source_metadata = content["data_source_metadata"]
        query = content["query"]

        
        query_completion_agent = QueryCompletionAgent(client=client)
        reasoning, query = query_completion_agent.run(data_source_metadata, query)
        response = flask.jsonify({ "token": "", "status": "ok", "reasoning": reasoning, "query": query })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "reasoning": "unable to complete query", "query": "" })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response
