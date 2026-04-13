// =============================================================================
// HolyOS — BaseSkill: bázová třída pro všechny skilly
// =============================================================================

class BaseSkill {
  constructor({ name, slug, description, parameters }) {
    this.name = name;
    this.slug = slug;
    this.description = description;
    this.parameters = parameters || { type: 'object', properties: {} };
  }

  /**
   * Konvertuje skill na Claude tool definition
   */
  toToolDefinition() {
    return {
      name: this.slug.replace(/-/g, '_'),
      description: this.description,
      input_schema: this.parameters,
    };
  }

  /**
   * Spustí skill — každý potomek musí implementovat
   * @param {Object} params - vstupní parametry
   * @param {Object} context - { prisma }
   * @returns {Promise<Object>}
   */
  async execute(params, context) {
    throw new Error(`Skill ${this.slug}: execute() musí být implementován`);
  }
}

module.exports = BaseSkill;
