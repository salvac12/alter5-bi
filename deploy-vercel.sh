#!/bin/bash

# ═══════════════════════════════════════════════════════════
#  Alter5 BI - Script de Deploy a Vercel
# ═══════════════════════════════════════════════════════════

set -e  # Exit on error

echo "══════════════════════════════════════════════════════════"
echo "  Alter5 BI - Deploy a Vercel"
echo "══════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json no encontrado. Asegúrate de estar en el directorio del proyecto."
    exit 1
fi

echo "${BLUE}[1/6]${NC} Verificando Node.js y npm..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado. Instala Node.js desde https://nodejs.org/"
    exit 1
fi
if ! command -v npm &> /dev/null; then
    echo "❌ npm no está instalado. Instala Node.js desde https://nodejs.org/"
    exit 1
fi
echo "   ✓ Node $(node --version)"
echo "   ✓ npm $(npm --version)"
echo ""

# 2. Instalar dependencias si es necesario
echo "${BLUE}[2/6]${NC} Verificando dependencias..."
if [ ! -d "node_modules" ]; then
    echo "   Instalando dependencias..."
    npm install
else
    echo "   ✓ Dependencias ya instaladas"
fi
echo ""

# 3. Verificar build local
echo "${BLUE}[3/6]${NC} Verificando que el build funciona..."
npm run build
if [ $? -eq 0 ]; then
    echo "   ✓ Build exitoso"
else
    echo "❌ Error en el build. Revisa los errores arriba."
    exit 1
fi
echo ""

# 4. Inicializar Git si no existe
echo "${BLUE}[4/6]${NC} Inicializando Git..."
if [ ! -d ".git" ]; then
    git init
    git add .
    git commit -m "Initial commit - Alter5 BI v1.0"
    echo "   ✓ Repositorio Git inicializado"
else
    echo "   ✓ Git ya inicializado"
    # Verificar si hay cambios sin commitear
    if [[ -n $(git status -s) ]]; then
        echo "   ${YELLOW}⚠ Hay cambios sin commitear. ¿Quieres commitearlos? (y/n)${NC}"
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            git add .
            git commit -m "Update before Vercel deploy"
            echo "   ✓ Cambios commiteados"
        fi
    fi
fi
echo ""

# 5. Instalar Vercel CLI si no está instalado
echo "${BLUE}[5/6]${NC} Verificando Vercel CLI..."
if ! command -v vercel &> /dev/null; then
    echo "   Instalando Vercel CLI..."
    npm install -g vercel
    echo "   ✓ Vercel CLI instalado"
else
    echo "   ✓ Vercel CLI ya instalado ($(vercel --version))"
fi
echo ""

# 6. Deploy a Vercel
echo "${BLUE}[6/6]${NC} Deployando a Vercel..."
echo ""
echo "${YELLOW}IMPORTANTE:${NC}"
echo "  1. Si es la primera vez, Vercel te pedirá hacer login (se abrirá el navegador)"
echo "  2. Confirma el nombre del proyecto cuando te lo pregunte"
echo "  3. Acepta las configuraciones detectadas automáticamente"
echo ""
echo "Presiona Enter para continuar..."
read -r

# Deploy a producción
vercel --prod

echo ""
echo "══════════════════════════════════════════════════════════"
echo "${GREEN}  ✓ Deploy completado${NC}"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "Tu aplicación está disponible en la URL que Vercel mostró arriba."
echo ""
echo "Próximos pasos:"
echo "  • Copia la URL de producción"
echo "  • Prueba la aplicación en producción"
echo "  • Configura el dominio personalizado en Vercel Dashboard (opcional)"
echo ""
