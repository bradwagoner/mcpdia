# Permissions

## Permission system

Roles grant actions on resources; groups hold roles; a user gets the union of roles from every group.

Also called: perms, access control, RBAC.

Kestrel uses role-based access control. A role is a named set of actions on resource types (for example `invoice:approve`). Roles are never assigned to users directly: users join groups, and groups hold roles. A user's effective permissions are the union of the roles on every group they belong to, within one workspace.

There is no "deny" rule. If someone must lose an action, remove them from the group that grants it, or split the group. This keeps every check a simple set lookup and makes audits readable.

Permissions are scoped to a workspace. A user in two workspaces has two independent permission sets, and nothing carries over between them, including the Owner role.

The check runs server side only (see the permission check). The web app hides buttons using the same data, but hiding is cosmetic.

See also: Roles; Groups; Permission check; Permission cache.

## Roles

Named sets of actions. Five built-in roles; custom roles on the Business plan only.

A role is a list of actions in the form `resource:verb`. Kestrel ships five built-in roles: Owner, Admin, Approver, Member and Viewer. Built-in roles cannot be edited or deleted; their action lists are defined in code in `server/auth/builtin-roles.ts` and change only with a migration.

Custom roles are available on the Business plan only. A workspace can have at most 40 custom roles, and a custom role can hold at most 120 actions. Custom role names must be unique per workspace, case-insensitive.

Roles are versioned: editing a custom role writes a new version and records who changed it in the audit log.

See also: Permission system.

## Built-in roles

Owner, Admin, Approver, Member, Viewer: what each can do, and the one-Owner rule.

- **Owner:** everything, including billing, deleting the workspace and transferring ownership. Exactly one Owner per workspace at all times.
- **Admin:** everything except billing, workspace deletion and ownership transfer. Can manage groups and custom roles.
- **Approver:** can approve or reject invoices and expense reports up to the workspace's approval limit, plus everything a Member can do.
- **Member:** create and edit their own invoices, expenses and clients; read shared clients.
- **Viewer:** read-only access to invoices and reports; cannot see bank details.

Ownership transfer requires the new Owner to accept by email within 72 hours, otherwise the transfer is cancelled.

See also: Roles.

## Groups

Groups hold roles and members. Every workspace has an Everyone group that cannot be deleted.

A group has members (users) and roles. Every workspace starts with an `Everyone` group that every member joins automatically and that cannot be deleted; by default it holds the Member role.

Groups can be nested one level only: a group may include other groups, but an included group may not include further groups. This limit exists because the permission check flattens membership at login, and deeper nesting made that step slow on large workspaces.

Groups can be synced from an identity provider over SCIM (Business plan). A synced group is read-only in Kestrel; changes must be made in the identity provider.

See also: Permission system.

## Permission check

One function, can(user, action, resource), runs on every API request and reads the permission cache.

Also called: authorization check, can().

All authorization goes through `can(user, action, resource)` in `server/auth/can.ts`. API handlers call it through the `@requires('invoice:approve')` decorator; calling it by hand is allowed only in background jobs.

The function loads the user's flattened action set from the permission cache, checks the action, then applies resource rules: ownership (Members may edit only what they created) and the approval limit for Approvers.

A failed check returns HTTP 403 with error code `forbidden` and never reveals whether the resource exists. Every failed check on a write action is written to the audit log.

See also: Permission system; Permission cache.

## Permission cache

Flattened action sets per user and workspace, kept in Redis for 5 minutes and busted on group or role changes.

Flattening groups and roles on every request was too slow, so the result is cached in Redis under `perm:{workspaceId}:{userId}` with a time to live of 5 minutes.

The cache is busted (deleted) whenever a group's members or roles change, or a custom role is edited. Busting is per workspace: an edit deletes every `perm:{workspaceId}:*` key in that workspace.

Because of the 5-minute TTL, a permission removed outside Kestrel (for example by a SCIM sync that failed to send a webhook) can still work for up to 5 minutes. That is an accepted risk, written up in the decision on cache TTL.

See also: Permission system; Redis.

## Permission cache TTL is 5 minutes

Chose 5 minutes over 60 seconds: cache hit rate fell from 97% to 81% at 60 seconds in load tests.

Decided 2025-03. We tried 60 seconds first. In load tests at 400 requests per second the cache hit rate dropped from 97% to 81%, and p95 API latency rose by 38 ms. Five minutes keeps the hit rate above 95%.

The risk is that a revoked permission keeps working until the entry expires if the bust event is lost. Mitigations: busting on every group or role change, and an "emergency revoke" admin action that busts the whole workspace immediately.

Revisit if we add per-resource sharing, which would multiply cache keys.

See also: Permission cache.

## Approval limit

Per-workspace cap on what an Approver can approve alone; above it, an Admin or Owner must also approve.

Also called: approval threshold.

Each workspace sets an approval limit, defaulting to 5,000 in the workspace currency. An Approver can approve invoices and expense reports at or below the limit alone. Above it, a second approval from an Admin or the Owner is required, and the item shows "Needs second approval".

The limit is compared against the total including tax. Changing the limit does not re-evaluate items that are already approved.

See also: Built-in roles; Expense reports.

## Audit log

Append-only record of security-relevant events, kept 400 days, exportable as CSV by Owners and Admins.

The audit log records sign-ins, failed sign-ins, permission changes, failed write checks, exports, ownership transfers and changes to bank details. Entries are append-only and stored in the `audit_events` table, partitioned by month.

Entries are kept for 400 days, then moved to cold storage in S3 Glacier for seven years for compliance. Owners and Admins can filter the log in Settings and export it as CSV; exports are themselves logged.

See also: Permission check.

## Single sign-on

SAML and OIDC sign-in on the Business plan; enforcing SSO disables password sign-in except for the Owner.

Also called: SAML, OIDC.

Business plan workspaces can configure SAML 2.0 or OIDC. Tested providers: Okta, Microsoft Entra ID and Google Workspace.

When an Admin turns on "Enforce SSO", password sign-in is disabled for everyone except the Owner, who keeps a password as a break-glass account. Sessions created by SSO last 12 hours; password sessions last 14 days.

See also: Groups.

## API key scopes

API keys carry a subset of their creator’s actions and stop working if the creator loses them.

Workspace API keys are created by a user and choose scopes from that user's own actions; a key can never do more than its creator. The check runs against both: the key's scopes and the creator's current permissions. If the creator leaves the workspace or loses a role, their keys lose those actions too.

Keys start with `kst_live_` or `kst_test_`. Only a hash is stored; the full key is shown once at creation.

See also: Permission check; Public API.

## Add a custom role

Settings > Roles > New role; pick actions; attach the role to a group, never to a user.

1. Settings > Roles > New role (Business plan only; the button is hidden on other plans).
2. Name the role and pick actions. Start from a built-in role with "Copy from" to avoid missing read actions.
3. Save, then open Settings > Groups, pick a group and add the role.

Common mistake: creating a role and expecting it to apply. Roles only take effect through a group.

See also: Roles.

## Most permission tickets are group membership

Support review: about 70% of "I cannot do X" tickets were a user missing from a group, not a bug.

Reviewed 212 permission tickets from Q2 2025. About 70% were users not in the group that grants the action, 15% were the 5-minute cache after a change, and the rest were real bugs or plan limits. Support now asks "which groups is the user in?" first.

See also: Permission system.
