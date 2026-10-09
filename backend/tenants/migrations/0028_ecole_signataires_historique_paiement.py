from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tenants', '0027_transaction_plan'),
    ]

    operations = [
        migrations.AddField(
            model_name='ecole',
            name='signataire_comptable',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='ecole',
            name='signataire_comptable_nom',
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name='ecole',
            name='signataire_caissier',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='ecole',
            name='signataire_caissier_nom',
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name='ecole',
            name='signataire_fondateur',
            field=models.BooleanField(default=False),
        ),
    ]
