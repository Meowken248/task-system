from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0121_alter_estimate_type")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="metanode_wallet_address",
            field=models.CharField(blank=True, max_length=42, null=True, unique=True),
        ),
    ]
