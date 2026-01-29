# Azure AI Foundry + MCP + APIM Demo

✅ **MCP Server Status: WORKING**  
🔐 **Authentication: Managed Identity (Required)**

> ⚠️ **IMPORTANT**: API key authentication has been disabled on Azure AI Foundry. This application now uses **Azure Managed Identity** for all authentication. See [MANAGED_IDENTITY_MIGRATION.md](./MANAGED_IDENTITY_MIGRATION.md) for setup instructions.

This repo demonstrates a complete **end-to-end automated deployment** of an AI Agent with Model Context Protocol (MCP) capabilities, deployed via GitHub Actions.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions CI/CD                        │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ 1. Deploy MCP Server to Azure App Service                    │  │
│  │ 2. Configure APIM Gateway                                     │  │
│  │ 3. Grant Service Principal Permissions                        │  │
│  │ 4. Create/Update AI Agent with MCP Tools                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ↓                                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               ↓
    ┌──────────────────────────────────────────────────────────┐
    │              Azure AI Foundry Project                    │
    │  ┌────────────────────────────────────────────────────┐  │
    │  │        AI Agent (document-analysis-agent)          │  │
    │  │        Model: gpt-4o-mini                          │  │
    │  │        Tools: MCP Server Connection                │  │
    │  └──────────────┬─────────────────────────────────────┘  │
    └─────────────────┼────────────────────────────────────────┘
                      │ MCP Protocol (SSE)
                      ↓
    ┌─────────────────────────────────────────────────────────┐
    │          Azure API Management (Optional)                │
    │          Security, Rate Limiting, Monitoring            │
    └──────────────┬──────────────────────────────────────────┘
                   │
                   ↓
    ┌─────────────────────────────────────────────────────────┐
    │          MCP Server (Azure App Service)                 │
    │          https://mcp-server-app-*.azurewebsites.net     │
    │  ┌────────────────────────────────────────────────────┐ │
    │  │  MCP Tools:                                        │ │
    │  │  • list_documents   - List uploaded documents      │ │
    │  │  • get_document     - Retrieve document content    │ │
    │  │  • search_documents - Search across documents      │ │
    │  │  • upload_document  - Upload new documents         │ │
    │  └────────────────────────────────────────────────────┘ │
    └─────────────────────────────────────────────────────────┘
```

## 🔐 Authentication & Authorization Flow

```
GitHub Actions Workflow
    ↓ Uses credentials from GitHub Secrets
Service Principal (github-deployer)
    ├─ Role: Contributor (Subscription)
    │  └─ Can deploy resources, manage App Services, APIM
    │
    └─ Roles on AI Project Resource:
       ├─ Azure AI User
       │  └─ Data action: Microsoft.CognitiveServices/*
       │     └─ Includes: agents/write (create agents)
       │
       └─ Cognitive Services OpenAI Contributor
          └─ Data action: Microsoft.CognitiveServices/accounts/OpenAI/*
             └─ Includes: Use OpenAI models
```

## ✨ Features

✅ **Fully Automated Deployment** - Push to main branch → Everything deploys automatically  
✅ **Document Upload & Analysis** - Upload TXT/CSV files or paste text  
✅ **MCP Protocol Support** - Full Model Context Protocol implementation  
✅ **Azure AI Agent Integration** - Automated agent creation with MCP tools  
✅ **APIM Gateway** - Secure API management and monitoring  
✅ **Permission Management** - Automatic service principal role assignment  
✅ **CI/CD Pipeline** - Complete infrastructure as code  

## Quick Start

### Prerequisites

1. **Azure AI Foundry Project** - Create one at https://ai.azure.com
2. **Azure Subscription** - Active Azure subscription with Contributor access
3. **Service Principal** - For GitHub Actions authentication
4. **GitHub Repository** - Fork or clone this repo

### 1. Create Azure Service Principal

```bash
# Create service principal for GitHub Actions
az ad sp create-for-rbac --name "github-deployer" \
  --role contributor \
  --scopes /subscriptions/<YOUR_SUBSCRIPTION_ID> \
  --sdk-auth

# Output will be JSON - save this for GitHub Secrets
```

### 2. Grant Additional Permissions

The service principal needs additional roles on your AI Foundry project:

```bash
# Set variables
SUBSCRIPTION_ID="<your-subscription-id>"
RESOURCE_GROUP="<your-ai-project-resource-group>"
AI_PROJECT_RESOURCE="<your-ai-project-resource-name>"
SERVICE_PRINCIPAL_ID="<client-id-from-step-1>"

# Get resource ID
RESOURCE_ID=$(az resource show \
  --name "$AI_PROJECT_RESOURCE" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id -o tsv)

# Grant Azure AI User role (for agent creation)
az role assignment create \
  --assignee "$SERVICE_PRINCIPAL_ID" \
  --role "Azure AI User" \
  --scope "$RESOURCE_ID"

# Grant OpenAI Contributor role (for model access)
az role assignment create \
  --assignee "$SERVICE_PRINCIPAL_ID" \
  --role "Cognitive Services OpenAI Contributor" \
  --scope "$RESOURCE_ID"
```

### 3. Configure GitHub Secrets

   Go to **Settings** → **Secrets and variables** → **Actions** and add:

   | Secret Name | Description | Example | Required | Notes |
   |-------------|-------------|---------|----------|-------|
   | `AZURE_CREDENTIALS` | Service principal JSON from step 1 | `{"clientId":"...","clientSecret":"..."}` | ✅ Yes | For GitHub Actions deployment |
   | `AI_PROJECT_RESOURCE_GROUP` | Resource group of your AI project | `AI-RG` | ✅ Yes | |
   | `AI_PROJECT_NAME` | AI Foundry project resource name | `my-project-resourcev2` | ✅ Yes | Resource name, not display name |
   | `FOUNDRY_ENDPOINT` | Azure AI Foundry model endpoint | `https://...openai.azure.com/` | ✅ Yes | |
   | `FOUNDRY_API_KEY` | Azure AI Foundry API key | `sk-...` | ❌ No | **Optional** - Managed Identity is used if not set |

   > **Note**: The web app uses **Managed Identity** for authentication to AI Foundry. The `FOUNDRY_API_KEY` is optional and only kept for backward compatibility. For production, it's recommended to remove this secret entirely.

   **Note**: The AI_PROJECT_NAME is usually the **resource name** (often ends with `-resourcev2`), not the project display name.

### 4. Update Workflow Variables (Optional)

Edit `.github/workflows/deploy.yml` to customize:

```yaml
env:
  AZURE_RESOURCE_GROUP: ai-mcp-rg          # Where MCP server will be deployed
  LOCATION: westeurope                      # Azure region
  WEBAPP_NAME: mcp-server-app-<your-name>  # Must be globally unique
  APIM_NAME: mcp-apim-<your-name>          # Must be globally unique
  AI_AGENT_NAME: document-analysis-agent    # Name for your AI agent
```

### 5. Deploy

```bash
git add .
git commit -m "Configure for my Azure environment"
git push origin main
```

The GitHub Actions pipeline will automatically:
1. ✅ Deploy MCP server to Azure App Service
2. ✅ Create/configure APIM gateway  
3. ✅ Grant service principal permissions (if needed)
4. ✅ Wait for permission propagation (2 minutes)
5. ✅ Create AI Agent with MCP tools configured

### 6. Verify Deployment

After ~5-10 minutes, check:

- **MCP Server**: `https://<WEBAPP_NAME>.azurewebsites.net/mcp/sse`
- **AI Agent**: https://ai.azure.com → Your Project → Agents → `document-analysis-agent`

## 🔄 CI/CD Pipeline Details

The GitHub Actions workflow (`.github/workflows/deploy.yml`) automates the entire deployment:

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: Infrastructure Setup                                  │
├─────────────────────────────────────────────────────────────────┤
│ • Create Azure Resource Group                                  │
│ • Deploy Azure App Service Plan                                │
│ • Deploy Azure App Service (for MCP server)                    │
│ • Configure App Service settings                               │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: MCP Server Deployment                                 │
├─────────────────────────────────────────────────────────────────┤
│ • Build Node.js application                                    │
│ • Deploy to App Service                                        │
│ • Configure environment variables (FOUNDRY_ENDPOINT, etc.)     │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: API Management (Optional)                             │
├─────────────────────────────────────────────────────────────────┤
│ • Create/Update APIM instance                                  │
│ • Import OpenAPI specification                                 │
│ • Configure backend services                                   │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Stage 4: Permission Management                                 │
├─────────────────────────────────────────────────────────────────┤
│ • Grant "Azure AI User" role (for agents/write)                │
│ • Grant "Cognitive Services OpenAI Contributor" role           │
│ • Wait 2 minutes for permission propagation                    │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Stage 5: AI Agent Creation                                     │
├─────────────────────────────────────────────────────────────────┤
│ • Discover AI Foundry project endpoint                         │
│ • Initialize Azure AI Projects SDK client                      │
│ • Create agent with MCP tool configuration:                    │
│   {                                                             │
│     "type": "mcp",                                              │
│     "server_label": "document_mcp_server",                     │
│     "server_url": "https://.../mcp/sse"                        │
│   }                                                             │
│ • Configure agent with instructions and model (gpt-4o-mini)    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Scripts

| Script | Purpose |
|--------|---------|
| `.github/scripts/get_project_endpoint.sh` | Discovers AI Foundry project endpoint from resource name |
| `.github/scripts/grant_permissions.sh` | Grants required roles to service principal |
| `.github/scripts/create_agent.py` | Creates AI agent using Azure AI Projects SDK |

### Troubleshooting the Pipeline

**Issue**: Permission denied errors during agent creation  
**Solution**: Ensure service principal has "Azure AI User" role (see step 2)

**Issue**: Project endpoint not found  
**Solution**: Verify `AI_PROJECT_NAME` is the **resource name** (check Azure Portal → Resource)

**Issue**: MCP server not responding  
**Solution**: Check App Service logs in Azure Portal → App Service → Log stream

## 🧪 Testing Your AI Agent

Once deployed, test your agent in Azure AI Foundry:

1. **Open Azure AI Foundry**: https://ai.azure.com
2. **Navigate to your project**
3. **Click "Agents"** in the left sidebar
4. **Open "document-analysis-agent"**
5. **Start a chat** and try these commands:

```
You: "List available documents"
Agent: [Uses list_documents MCP tool to show documents]

You: "Upload this text: Azure AI is amazing..."
Agent: [Uses upload_document MCP tool]

You: "What documents do I have?"
Agent: [Uses list_documents MCP tool]

You: "Tell me about the Azure AI document"
Agent: [Uses get_document MCP tool and summarizes]
```

## 📊 MCP Server Endpoints

The deployed MCP server exposes these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/sse` | GET | Model Context Protocol SSE endpoint (used by AI Agent) |
| `/session` | POST | Create new document session |
| `/session/{sid}/upload` | POST | Upload document to session |
| `/session/{sid}/query` | POST | Query documents in session |
| `/` | GET | Simple web UI for testing |

## 🔍 Understanding the Components

### Service Principal (github-deployer)

A **service principal** is an identity for automated tools (like GitHub Actions) to access Azure resources. It has these permissions:

| Role | Scope | Purpose |
|------|-------|---------|
| Contributor | Subscription | Deploy resources, manage App Services, APIM |
| Azure AI User | AI Project Resource | Create/manage AI agents (includes `agents/write`) |
| Cognitive Services OpenAI Contributor | AI Project Resource | Use OpenAI models |

### AI Foundry Project vs Resource

**Important distinction**:
- **AI Project Name**: Display name you see in https://ai.azure.com (e.g., `davidsr-ai-project`)
- **Resource Name**: The actual Azure resource name (e.g., `davidsr-ai-project-resourcev2`)

The GitHub Action needs the **resource name** (usually ends with `-resourcev2` or `-resource`).

### MCP Tool Configuration Format

The agent uses this JSON structure to connect to your MCP server:

```json
{
  "type": "mcp",
  "server_label": "document_mcp_server",
  "server_url": "https://mcp-server-app-*.azurewebsites.net/mcp/sse"
}
```

**Note**: `server_label` and `server_url` must be at the top level, not nested under a `mcp` key.

## 📚 Additional Resources

- [Azure AI Foundry Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Azure AI Agents Documentation](https://learn.microsoft.com/en-us/azure/ai-services/agents/)
- [Azure RBAC for AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/rbac-azure-ai-foundry)

## Endpoints

- `/session` → Create new session.
- `/session/{sid}/upload` → Upload text doc.
- `/session/{sid}/query` → Ask question or summarize.

