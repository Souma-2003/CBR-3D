# diagnostic_classes.py
from pymongo import MongoClient
import json

def diagnose_database():
    """Diagnostiquer les problèmes de la base de données"""
    client = MongoClient('mongodb://localhost:27017')
    db = client['image_search_db']
    collection = db['objects']
    
    print("🔍 Diagnostic de la base de données")
    print("=" * 60)
    
    # 1. Compter le nombre total de documents
    total = collection.count_documents({})
    print(f"📊 Total documents: {total}")
    
    # 2. Vérifier la structure d'un document
    sample = collection.find_one()
    if sample:
        print(f"\n📋 Structure du document:")
        print(f"   ID: {sample.get('_id')}")
        print(f"   Champs disponibles: {list(sample.keys())}")
        
        # Vérifier spécifiquement la classe
        print(f"\n🔍 Recherche du champ 'classe' ou 'object.class':")
        
        if 'classe' in sample:
            print(f"   ✓ 'classe' trouvé: {sample['classe']}")
        else:
            print(f"   ✗ 'classe' non trouvé")
            
        if 'object' in sample:
            obj = sample['object']
            print(f"   ✓ 'object' trouvé: {obj}")
            if 'class' in obj:
                print(f"     ✓ 'object.class' trouvé: {obj['class']}")
            else:
                print(f"     ✗ 'object.class' non trouvé")
        else:
            print(f"   ✗ 'object' non trouvé")
        
        # Vérifier les descripteurs
        if 'descriptors' in sample or 'descripteurs' in sample:
            descriptors = sample.get('descriptors', sample.get('descripteurs', {}))
            print(f"\n📊 Descripteurs: {list(descriptors.keys())}")
    
    # 3. Compter les documents par classe
    print(f"\n📈 Distribution par classe:")
    
    # Essayer plusieurs champs possibles
    fields_to_check = ['classe', 'object.class', 'class']
    
    for field in fields_to_check:
        try:
            if '.' in field:
                # Champ imbriqué comme object.class
                pipeline = [
                    {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}}
                ]
            else:
                pipeline = [
                    {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}}
                ]
            
            results = list(collection.aggregate(pipeline))
            print(f"\n  Par '{field}':")
            for r in results[:10]:  # Afficher les 10 premiers
                print(f"    {r['_id']}: {r['count']}")
                
        except Exception as e:
            print(f"  ⚠️ Erreur avec '{field}': {e}")
    
    # 4. Lister les 5 premiers documents pour voir le problème
    print(f"\n📄 Exemple des 5 premiers documents:")
    cursor = collection.find().limit(5)
    for i, doc in enumerate(cursor):
        print(f"\n  Document {i+1}:")
        print(f"    ID: {doc.get('_id')}")
        print(f"    Image ID: {doc.get('image_id')}")
        
        # Essayer de trouver la classe
        classe = None
        if 'classe' in doc:
            classe = doc['classe']
        elif 'object' in doc and 'class' in doc['object']:
            classe = doc['object']['class']
        elif 'class' in doc:
            classe = doc['class']
            
        print(f"    Classe trouvée: {classe}")
    
    client.close()
    
    print(f"\n{'=' * 60}")
    print("🎯 RECOMMANDATIONS:")
    print("  1. Si toutes les classes sont None, exécutez à nouveau precompute_descriptors.py")
    print("  2. Vérifiez les annotations YOLO (.txt)")
    print("  3. Assurez-vous que les IDs de classe dans les annotations correspondent à CUSTOM_CLASSES")
    print("=" * 60)

if __name__ == "__main__":
    diagnose_database()