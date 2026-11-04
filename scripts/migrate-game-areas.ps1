# HolyOS — migrace: trvalá cache prozkoumaných měst pro hru (game_areas)
# Databáze není z notebooku dostupná (Postgres nemá veřejnou proxy), proto
# se migrace pouští uvnitř Railway:
#   railway ssh --service attractive-consideration
#   npx prisma db execute --file prisma/migrations/20261105120000_game_areas/migration.sql --schema prisma/schema.prisma
#   npx prisma migrate resolve --applied 20261105120000_game_areas
Write-Host 'Spust prikazy z hlavicky tohoto souboru pres railway ssh.' -ForegroundColor Yellow
