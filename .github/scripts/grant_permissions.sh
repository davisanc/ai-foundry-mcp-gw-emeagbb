#!/bin/bash
# Grant permissions to GitHub Actions service principal for agent creation

PRINCIPAL_ID="65eb0117-372c-4f2f-83b9-3e163eceb1a1"
AI_PROJECT_NAME="${AI_PROJECT_NAME:-davidsr-ai-project-resource}"
RESOURCE_GROUP="${AI_PROJECT_RESOURCE_GROUP:-davidsr-AI-RG}"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID}"

echo "========================================================================"
echo "Grant Agent Creation Permissions"
echo "========================================================================"
echo "Principal ID: $PRINCIPAL_ID"
echo "Project: $AI_PROJECT_NAME"
echo "Resource Group: $RESOURCE_GROUP"
echo "Subscription: $SUBSCRIPTION_ID"
echo ""

# Get the resource ID
RESOURCE_ID=$(az resource show \
  --name "$AI_PROJECT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id \
  --output tsv)

if [ -z "$RESOURCE_ID" ]; then
  echo "❌ Could not find resource $AI_PROJECT_NAME"
  exit 1
fi

echo "Resource ID: $RESOURCE_ID"
echo ""

# Required roles for AI Foundry agents
# Azure AI User: Includes Microsoft.CognitiveServices/* data action (needed for agents/write)
# Cognitive Services OpenAI Contributor: For OpenAI model access
ROLES=("Azure AI User" "Cognitive Services OpenAI Contributor")

for ROLE_NAME in "${ROLES[@]}"; do
  echo "Checking role: $ROLE_NAME"
  EXISTING_ASSIGNMENT=$(az role assignment list \
    --assignee "$PRINCIPAL_ID" \
    --scope "$RESOURCE_ID" \
    --role "$ROLE_NAME" \
    --query "[0].id" \
    --output tsv 2>/dev/null)

  if [ -n "$EXISTING_ASSIGNMENT" ]; then
    echo "✅ Role '$ROLE_NAME' already assigned"
    echo "   Assignment ID: $EXISTING_ASSIGNMENT"
  else
    echo "Granting role: $ROLE_NAME"
    
    az role assignment create \
      --assignee "$PRINCIPAL_ID" \
      --role "$ROLE_NAME" \
      --scope "$RESOURCE_ID" \
      --output json
    
    if [ $? -eq 0 ]; then
      echo "✅ Successfully granted role: $ROLE_NAME"
    else
      echo "❌ Failed to grant role (may already exist or lack permissions)"
      echo "   If you see this error, run manually:"
      echo "   az role assignment create --assignee $PRINCIPAL_ID --role '$ROLE_NAME' --scope $RESOURCE_ID"
    fi
  fi
  echo ""
done
echo "========================================================================"
echo "Permission Grant Complete"
echo "========================================================================"
echo "The service principal can now create and manage agents."
echo ""
