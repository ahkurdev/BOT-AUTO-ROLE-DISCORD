'use strict';

const { PermissionFlagsBits } = require('discord.js');

/**
 * Pure authorization predicate for administrative subcommands.
 *
 * A member is considered an authorized admin if they hold the Discord
 * Administrator permission OR the Manage Roles permission.
 *
 * @param {{ has: (flag: bigint) => boolean }} memberPermissions
 *   A discord.js PermissionsBitField (or any object exposing `has(flag)`).
 *   Pure with respect to its input: only `memberPermissions.has` is called.
 * @returns {boolean} true iff the member has Administrator OR Manage Roles.
 */
function isAuthorizedAdmin(memberPermissions) {
  return (
    memberPermissions.has(PermissionFlagsBits.Administrator) ||
    memberPermissions.has(PermissionFlagsBits.ManageRoles)
  );
}

module.exports = { isAuthorizedAdmin };
