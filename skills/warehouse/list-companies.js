const BaseSkill = require('../base-skill');

class ListCompaniesSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Seznam dodavatelů',
      slug: 'list-companies',
      description: 'Vrátí seznam firem (dodavatelé, odběratelé) s kontaktními údaji.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Typ: supplier, customer, cooperation, both' },
          search: { type: 'string', description: 'Hledání podle názvu firmy' },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = { active: true };
    if (params.type) where.type = params.type;
    if (params.search) where.name = { contains: params.search, mode: 'insensitive' };

    const companies = await prisma.company.findMany({
      where,
      take: params.limit || 30,
      orderBy: { name: 'asc' },
    });

    return {
      count: companies.length,
      companies: companies.map(c => ({
        id: c.id,
        name: c.name,
        ico: c.ico,
        type: c.type,
        contact_person: c.contact_person,
        email: c.email,
        phone: c.phone,
        city: c.city,
        payment_terms_days: c.payment_terms_days,
      })),
    };
  }
}

module.exports = new ListCompaniesSkill();
