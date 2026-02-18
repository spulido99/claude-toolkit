"""
Complete example: Customer Service Deep Agent
Demonstrates all key patterns and best practices.
"""

import os
from typing import Literal
from deepagents import create_deep_agent
from langchain.tools import tool

# =============================================================================
# TOOLS DEFINITION
# =============================================================================

# Knowledge Base Tools
@tool
def search_knowledge_base(query: str, category: str = "all") -> list[dict]:
    """Search customer support knowledge base for relevant articles.
    
    Args:
        query: Search terms or customer question
        category: Filter by category (products, policies, troubleshooting, all)
        
    Returns:
        List of articles with title, content, relevance_score
    """
    # Simulated implementation
    return [
        {"title": "Return Policy", "content": "...", "relevance": 0.95},
        {"title": "Shipping Times", "content": "...", "relevance": 0.82}
    ]

@tool
def get_policy_details(policy_type: Literal["return", "shipping", "warranty"]) -> dict:
    """Fetch complete details for a specific company policy.
    
    Args:
        policy_type: Type of policy to retrieve
        
    Returns:
        Complete policy document with terms, conditions, exceptions
    """
    policies = {
        "return": "30-day return policy, original packaging required...",
        "shipping": "Free shipping on orders > $50, 2-5 business days...",
        "warranty": "1-year manufacturer warranty on all electronics..."
    }
    return {"policy": policy_type, "details": policies.get(policy_type, "")}

# Order Management Tools
@tool
def lookup_order(order_id: str) -> dict:
    """Retrieve order details and current status.
    
    Args:
        order_id: Order ID (format: ORD-XXXXXX)
        
    Returns:
        Order details including items, status, tracking, payment
    """
    return {
        "order_id": order_id,
        "status": "shipped",
        "items": [{"name": "Widget", "quantity": 2, "price": 29.99}],
        "tracking": "1Z999AA10123456784",
        "total": 59.98
    }

@tool
def modify_order(order_id: str, modification: dict) -> dict:
    """Modify an order before shipping (cancel, change address, add items).
    
    Args:
        order_id: Order ID to modify
        modification: Dict with modification type and details
        
    Returns:
        Updated order details and confirmation
    """
    return {
        "order_id": order_id,
        "modification": modification,
        "status": "modified",
        "confirmation": "MOD-789"
    }

@tool
def track_shipment(tracking_number: str) -> dict:
    """Get current shipment tracking information.
    
    Args:
        tracking_number: Carrier tracking number
        
    Returns:
        Current location, estimated delivery, tracking history
    """
    return {
        "tracking": tracking_number,
        "status": "In Transit",
        "location": "Distribution Center - Chicago, IL",
        "estimated_delivery": "2025-11-22",
        "history": [
            {"date": "2025-11-20", "event": "Picked up"},
            {"date": "2025-11-21", "event": "In transit"}
        ]
    }

# Issue Resolution Tools
@tool
def create_support_ticket(
    customer_email: str,
    issue_type: str,
    description: str,
    priority: Literal["low", "medium", "high"] = "medium"
) -> dict:
    """Create a customer support ticket for tracking.
    
    Args:
        customer_email: Customer's email address
        issue_type: Type of issue (technical, billing, shipping, product)
        description: Detailed problem description
        priority: Ticket priority level
        
    Returns:
        Ticket ID and initial status
    """
    return {
        "ticket_id": "TKT-12345",
        "status": "open",
        "priority": priority,
        "assigned_to": "Support Team",
        "created_at": "2025-11-20T10:30:00Z"
    }

@tool
def run_diagnostic(product_id: str, issue_description: str) -> dict:
    """Run automated diagnostics for technical issues.
    
    Args:
        product_id: Product SKU or model number
        issue_description: Description of the problem
        
    Returns:
        Diagnostic results with likely causes and solutions
    """
    return {
        "product": product_id,
        "likely_causes": ["Low battery", "Firmware outdated"],
        "solutions": [
            "Charge device for 2 hours",
            "Update firmware via app"
        ],
        "confidence": 0.85
    }

# Refund/Exchange Tools
@tool
def process_refund(order_id: str, amount: float, reason: str) -> dict:
    """Process a customer refund (requires approval for amounts > $100).
    
    Args:
        order_id: Order ID for refund
        amount: Refund amount in USD
        reason: Reason for refund
        
    Returns:
        Refund confirmation and processing time
    """
    return {
        "refund_id": "REF-456",
        "order_id": order_id,
        "amount": amount,
        "status": "pending" if amount > 100 else "approved",
        "processing_days": 5-7
    }

@tool
def initiate_exchange(order_id: str, exchange_details: dict) -> dict:
    """Initiate product exchange process.
    
    Args:
        order_id: Original order ID
        exchange_details: Dict with item_id, reason, new_item_id
        
    Returns:
        Exchange confirmation and return shipping label
    """
    return {
        "exchange_id": "EXC-789",
        "return_label": "https://example.com/label/123",
        "status": "initiated",
        "instructions": "Print label and ship within 14 days"
    }

# =============================================================================
# AGENT CONFIGURATION
# =============================================================================

def create_customer_service_agent():
    """Create a production-ready customer service deep agent."""
    
    # Define subagents with clear bounded contexts
    subagents = [
        # INQUIRY HANDLER: Answers questions
        {
            "name": "inquiry-handler",
            "description": "Answers customer questions about products, orders, policies, and general information. Use for any informational requests.",
            "prompt": """You handle customer inquiries. In the support context:
            
## Your Role
Answer customer questions clearly and accurately using available knowledge resources.

## Context & Vocabulary
- 'Customer' = person making purchase or inquiry
- 'Inquiry' = question needing answer
- 'Knowledge Base' = FAQ and help documentation
- 'Policy' = company rules (returns, shipping, warranty)

## Workflow
1. Search knowledge base for relevant information
2. If policy question, get official policy details
3. Provide clear, friendly answer
4. Offer to help with related questions

## Tool Usage
- Use search_knowledge_base for general questions
- Use get_policy_details for specific policy questions
- Always provide source information (KB article title or policy name)

## When to Escalate
- Question requires order-specific information → delegate to order-specialist
- Question is about a problem/issue → delegate to issue-resolver
- Cannot find answer in knowledge base → create support ticket
            """,
            "tools": [search_knowledge_base, get_policy_details]
        },
        
        # ISSUE RESOLVER: Diagnoses and fixes problems
        {
            "name": "issue-resolver",
            "description": "Diagnoses and resolves customer problems, complaints, and technical issues. Use when customer reports a problem.",
            "prompt": """You resolve customer issues. In the support context:

## Your Role
Diagnose problems, provide solutions, and ensure customer satisfaction.

## Context & Vocabulary
- 'Issue' = problem preventing customer satisfaction
- 'Resolution' = fix, workaround, or compensation
- 'Diagnostic' = systematic problem investigation
- 'Escalation' = route to specialist or create ticket

## Workflow
1. Understand the problem fully
2. For technical issues: run diagnostics
3. Provide solution or workaround
4. If unresolved: create support ticket
5. Confirm customer satisfaction

## Tool Usage
- Use run_diagnostic for product/technical problems
- Use create_support_ticket if issue requires specialist
- Always document issue and resolution

## Decision Rules
- Simple issues: Provide solution directly
- Complex issues: Create ticket (high priority)
- Product defects: Offer refund/exchange
- Technical problems: Run diagnostic first

## When to Escalate
- Cannot resolve after diagnostic
- Customer requests manager/specialist
- Issue involves safety or legal concerns
            """,
            "tools": [run_diagnostic, create_support_ticket, process_refund, initiate_exchange]
        },
        
        # ORDER SPECIALIST: Manages orders
        {
            "name": "order-specialist",
            "description": "Manages orders, shipments, tracking, and order modifications. Use for any order-related requests.",
            "prompt": """You manage orders. In the order management context:

## Your Role
Handle all order-related operations: lookup, tracking, modifications.

## Context & Vocabulary
- 'Order' = customer purchase transaction
- 'Status' = current fulfillment stage (pending, processing, shipped, delivered)
- 'Tracking' = shipment location and progress
- 'Modification' = change before shipping (cancel, address change, add items)

## Workflow
1. Look up order by order ID
2. Provide current status and details
3. For tracking: get shipment information
4. For modifications: check if eligible (not yet shipped)
5. Process modification if possible

## Tool Usage
- Use lookup_order for order details and status
- Use track_shipment for delivery information
- Use modify_order ONLY if status is 'pending' or 'processing'

## Decision Rules
- Order not shipped: Can modify
- Order shipped: Cannot modify, can track
- Order delivered: Refer to return policy

## When to Escalate
- Modification not possible → explain why, offer alternatives
- Missing order → create support ticket
- Delivery issues → create support ticket
            """,
            "tools": [lookup_order, track_shipment, modify_order]
        }
    ]
    
    # Create main orchestrator agent
    agent = create_deep_agent(
        model="anthropic:claude-sonnet-4-5-20250929",
        
        system_prompt="""You are a Customer Service Coordinator for an e-commerce company.

## Your Mission
Provide excellent customer service by understanding requests and delegating to appropriate specialists.

## Your Team
- inquiry-handler: Answers questions about products, policies, information
- issue-resolver: Solves problems, complaints, technical issues
- order-specialist: Manages orders, tracking, and modifications

## Your Process
1. Understand the customer's need
2. Determine which specialist can best help
3. Delegate to that specialist
4. Synthesize the response into a friendly, helpful message
5. Ask if customer needs additional help

## Delegation Guidelines
- Questions/information → inquiry-handler
- Problems/complaints → issue-resolver
- Orders/tracking/modifications → order-specialist

## You Do NOT
- Answer questions directly (delegate to inquiry-handler)
- Resolve issues yourself (delegate to issue-resolver)
- Look up orders yourself (delegate to order-specialist)

## Communication Style
- Friendly, professional, empathetic
- Acknowledge concerns
- Be clear about next steps
- Set realistic expectations

## Escalation to Human
- Customer explicitly requests human agent
- Issue unresolved after all specialists tried
- Emotional distress detected
- Legal/compliance concerns
        """,
        
        subagents=subagents,
        
        # Configure human-in-the-loop for sensitive operations
        interrupt_on={
            "process_refund": {
                "allowed_decisions": ["approve", "reject"]
            }
        }
    )
    
    return agent

# =============================================================================
# EXAMPLE USAGE
# =============================================================================

if __name__ == "__main__":
    # Create the agent
    agent = create_customer_service_agent()
    
    # Example conversations
    examples = [
        "What is your return policy?",
        "I received a defective product, it won't turn on",
        "Can you tell me where my order ORD-123456 is?",
        "I want to cancel my order ORD-123456",
        "The product I received is damaged, I want a refund"
    ]
    
    print("=" * 70)
    print("CUSTOMER SERVICE AGENT - Examples")
    print("=" * 70)
    
    for query in examples:
        print(f"\nCustomer: {query}")
        print("-" * 70)
        
        result = agent.invoke({
            "messages": [{"role": "user", "content": query}]
        })
        
        response = result["messages"][-1].content
        print(f"Agent: {response}\n")
