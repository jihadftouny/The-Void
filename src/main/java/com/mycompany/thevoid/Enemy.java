/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import static com.mycompany.thevoid.Player.staticStatsMods;
import java.util.ArrayList;
import java.util.Random;

/**
 *
 * @author jihad
 */
public class Enemy extends Character {

    Random rand = new Random();

    //CR = challenge rating
    double CRmax, CRmin, CRboss;

    String type;

    public static int enemyEncounteredCount = 0;
    public static int enemyDefeatedCount = 0;

    public static int[] staticStatsMods;
    public static int[] staticStats;
    public int [] finalStats = {0,0,0,0,0,0};

    public static int[] Resistances; //physical, cryo, pyro, electro, poison, psychic, force
    public static int physResistance;
    public static int cryoResistance;
    public static int pyroResistance;
    public static int elecResistance;
    public static int poisResistance;
    public static int psycResistance;
    public static int forcResistance;

    public static Skill pickedSkill;

    EnemyName enemyName;
    public static String fullName = "";

    public static String pickedSkillString;

    public static ArrayList<Condition> activeConditions;

    int playerXp;

    public Enemy(String type, int playerXp) {
        super(type, 1, (int) (Math.random() * (playerXp / 4 + 2) + 1)); //name maxhp xp
        this.playerXp = playerXp; //this here sets the variable playerXp with the variable that was given in the parameter declaration (which was set on object creation)

        enemyName = new EnemyName(type);
        this.type = type;
        fullName = enemyName.fullName;

        setStatsEnemy();

        Enemy.Resistances = new int[]{0, 0, 0, 0, 0, 0};

        activeConditions = new ArrayList<>();

        skillPool = new ArrayList<>();

        //TEST SKILL ADDS, every enemy will have these skills on them (for now)
//        skillPool.add(SkillEnemy.testFireSkill);
//        skillPool.add(SkillEnemy.testFireSkill);

        maxSkillCharges = 2;

        skillCharges = maxSkillCharges;

        //temporary for test
        staticStatsMods = StatsMods;
        staticStats = Stats;

        // You can set maxHP and currentHp like this after getting the stats
        this.maxHp = 5;
        this.hp = maxHp;

        ++enemyEncounteredCount;
    }

    public int useSkill(ArrayList<Skill> skillPool) {

        // create random selector and pick  from skillpool array
        int index = rand.nextInt(skillPool.size());

        pickedSkill = skillPool.get(index);

        int damage = pickedSkill.damage();
        if (pickedSkill.condition1 != null) {
            pickedSkill.addConditionTarget(pickedSkill.condition1);
        }
        if (pickedSkill.condition2 != null) {
            pickedSkill.addConditionTarget(pickedSkill.condition2);
        }

        pickedSkillString = pickedSkill.useText();
        return damage;
    }

    //CONTHERE
    public void setStatsEnemy() {
        double a;
        double b;
        int playerLevel = GameLogic.act;

        //this if else chain will set playerLevel randomly based on act, utilizing DnD Levels of play
        if (playerLevel == 4) {
            playerLevel = 19;   // 20 WILL BE FOR BOSS
        } else if (playerLevel == 3) {
            playerLevel = 18;   // 16-11
        } else if (playerLevel == 2) {
            playerLevel = 17;
        } else {
            playerLevel = 16;
        }

        //The following will set max and minimum (also boss) Challenge Ratings based on playerLevel
        //min
        a = 0.087970550572;
        b = 1.4100213799828;
        CRmin = a * Math.pow(playerLevel, b);

        //max
        a = 0.2320721484759;
        b = 1.319592522878;
        CRmax = a * Math.pow(playerLevel, b);

        //boss
        a = 0.4294334810279;
        b = 1.165240310288;
        CRboss = a * Math.pow(playerLevel, b);

        double generatedCR;
        int generatedStat;

        for (int i = 0; i <= 5; i++) {
            generatedCR = ((Math.random() * (CRmax - CRmin)) + CRmin);
            generatedStat = (int) ((Math.pow(generatedCR, 1.35)) * 0.9 + 1);
            this.Stats[i] = generatedStat;
        }

        int[] tempStats = {Stats[0], Stats[1], Stats[2], Stats[3], Stats[4], Stats[5]};

        if ("Beast".equals(type)) {
            //more STR, DEX, CON than WIS, INT, CHA
            for (int i = 0; i < tempStats.length; i++) {
                finalStats[i] = tempStats[i]; // copy the values from tempStats to finalStats
            }

        }
        if ("Humanoid".equals(type)) {
            //Leave as be
        }
        if ("Mech".equals(type)) {
            //Extreme INT CON, avg STR DEX, low WIS CHA
        }
        if ("Magical".equals(type)) {
            //more INT WIS CHA, low STR DEX CON
        }
        if ("Nightmare".equals(type)) {
            //Specific design for each
        }
        if ("Ancestral".equals(type)) {
            //Specific design for each
        }

    }

    public void setSkillsEnemy(String enemyName) {

    }

    public void setModsEnemy(String enemyName) {

    }
    //CONTHERE ENDS

    @Override
    public void setResistance(int indexElement, int percentage) {
        this.Resistances[indexElement] = percentage;

        physResistance = Resistances[0];
        cryoResistance = Resistances[1];
        pyroResistance = Resistances[2];
        elecResistance = Resistances[3];
        poisResistance = Resistances[4];
        psycResistance = Resistances[5];
        forcResistance = Resistances[6];
    }

    @Override
    public int attack() {
        int damage = 0;
        if (skillCharges > 0) {
//            damage = useSkill(skillPool);
            damage = (int) ((Math.random()*4) - 2);
            skillCharges--;
        } else {
            damage = 1;
        }
        return damage;
//        return (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

    @Override
    public int defend() {
        return 0;
//        return (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

    @Override
    public void setArmorClass() {
        armorClass = 10;
    }

    @Override
    public int atkRoll() {
        int diceRoll = Dice.rollDice(Dice.d20);
        int diceRollOg = diceRoll;

        diceRoll += StatsMods[0];

        System.out.println("Atk Roll: " + diceRoll);

        if (diceRoll < 1) {
            diceRoll = 1;
        }
        if (diceRollOg == 20) {
            diceRoll = 8000; //8000 will be used as a critical success
        }
        if (diceRollOg == 1) {
            diceRoll = 8001; //8001 will be used as a a critical fail
        }

        if (diceRoll < GameLogic.player.armorClass) {
            diceRoll = 0;
        }
        System.out.println("Atk Roll: " + diceRoll);
        GameLogic.anythingToContinue();

        return diceRoll;
    }
}
