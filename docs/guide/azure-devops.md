# Connect Azure DevOps

Azure DevOps tells Cadence **how code moves**: commits, pull requests raised and merged, reviews given to
teammates, and production deployments for **DORA delivery metrics**. Cadence only reads; it never pushes,
comments or approves.

Both **Azure DevOps Services** (`dev.azure.com`) and **Azure DevOps Server** are supported.

## 1. Create a Personal Access Token

1. In Azure DevOps, open **User settings → Personal access tokens → New Token**.
2. Name it `Cadence`, choose your **organization**, and set an expiry that suits your policy.
3. Under **Scopes**, choose *Custom defined* and tick only:

   | Scope | Why |
   |---|---|
   | **Code → Read** | Repositories, commits, pull requests and review threads |
   | **Build → Read** | Pipeline runs, used for deployments (DORA) |
   | **Identity → Read** | Finding people when you link their accounts |
   | **Project and Team → Read** | Listing projects |

4. Create the token and copy it.

> Tip: create the token from a service account that can read every project you want to measure.

## 2. Add the connection

As an administrator, open **Integrations → Connect Azure DevOps**:

| Field | Example | Notes |
|---|---|---|
| **Name** | `Azure DevOps` | Shown on cards and in each person's profile. |
| **Base URL** | `https://dev.azure.com/your-org` | For Server: your collection URL, e.g. `https://ado.company.com/DefaultCollection`. |
| **Projects** | `Retail, Growth` | Optional. Empty means every project in the organization. |
| **Deployment pipelines** | `storefront-deploy, web-release` | Optional. Which pipelines deploy to production ([details](#deployments-and-dora)). |
| **Environment label** | `production` | The name shown for those deployments. |
| **Personal access token** | n/a | Stored encrypted; never shown again. |

Choose **Save**, then **Test** on the card. You should see *"Connected — N project(s) visible"*.

## 3. Link people to their Azure DevOps accounts

On **People**, open a person's **⋯ menu → Link identities**, start typing their name in the Azure DevOps
field and pick them from the suggestions.

Cadence stores the person's **uniqueName**, which is usually their sign-in e-mail (for example
`mina@company.com`). Commits are matched on the author e-mail, so make sure people commit with the same
address.

## 4. Sync

Choose **Sync 14 days** on the card. After that Cadence syncs **every night**. Large organizations
can take a few minutes the first time.

## What Cadence reads

| Metric | How it's calculated |
|---|---|
| **Commits** | Commits in the selected projects' repositories, by author e-mail and author date. |
| **PRs raised** | Pull requests a person created, on the day they created them. |
| **PRs merged** | Their pull requests that were completed, on the day they were merged. |
| **Reviews** | Distinct pull requests a person **voted or commented on** each day, excluding their own. |

These numbers are merged with the person's Jira work into a single **combined profile**.

## Deployments and DORA

Cadence treats completed runs of your **deployment pipelines** as production deployments:

- If you list **Deployment pipelines**, exactly those pipelines count.
- Otherwise, any pipeline whose name contains `deploy`, `release`, `prod` or `cd` counts.
- A **succeeded** (or partially succeeded) run is a successful deployment, a **failed** run is a failed
  deployment, and **canceled** runs are ignored.
- **Lead time** is measured from the author time of the deployed commit to the end of the run.

Each pipeline becomes a **service** under **Delivery → Services**. Assign each service to the **team that
owns it**, so DORA metrics roll up to the right managers and tribes:

| DORA metric | Meaning in Cadence |
|---|---|
| **Deployment frequency** | Successful production deployments per day |
| **Lead time for changes** | Median time from commit to production |
| **Change failure rate** | Failed deployments ÷ all deployments |
| **Time to restore** | Median time from a failed deployment to the next successful one of the same service |

## Optional: near real-time updates with service hooks

1. In Cadence, open the connection's **webhook** dialog and choose **Generate secret**. Copy the
   **payload URL** and the **secret**.
2. In Azure DevOps, open **Project settings → Service hooks → Create subscription → Web Hooks**, and
   create one subscription for each event you care about:
   - *Code pushed*
   - *Pull request created*, *Pull request updated*, *Pull request merge attempted*
   - *Build completed* (for deployments)
3. For each subscription set:
   - **URL**: the payload URL
   - **HTTP headers**: `X-Cadence-Token: <your secret>`

Cadence re-syncs the affected days about a minute after the last event, so bursts of pushes cost a
single sync.

## Troubleshooting

| Symptom | Fix |
|---|---|
| *Test* fails with **401/203** | The token expired or lacks a scope from step 1. |
| Commits are missing for someone | Their commits use a different e-mail than their linked uniqueName. |
| No services under Delivery | No pipeline matched. Set **Deployment pipelines** explicitly. |
| Lead time is empty | The pipeline builds from a repository outside Azure Repos, so the commit time can't be looked up. |
