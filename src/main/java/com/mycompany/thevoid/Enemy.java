/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import jdk.nashorn.internal.objects.NativeArray;

/**
 *
 * @author jihad
 */
public class Enemy extends Character {

    Random rand = new Random();
    //variable that stores the player current xp
    int playerXp;
    public static String fullName = "";

    public static String pickedSkillString;
    
    EnemyName enemyName;

    public static ArrayList<Condition> activeConditions;

    public Enemy(String type, int playerXp) {
        super(type, 1, (int) (Math.random() * (playerXp / 4 + 2) + 1)); //name maxhp xp
        this.playerXp = playerXp; //this here sets the variable playerXp with the variable that was given in the parameter declaration (which was set on object creation)
        
        enemyName = new EnemyName(type);

        fullName = enemyName.fullName;

        Stats[0] = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
        Stats[1] = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);

        activeConditions = new ArrayList<Condition>();

        skillPool = new ArrayList<Skill>();

        //TEST SKILL ADDS, every enemy will have these skills on them (for now)
        skillPool.add(SkillEnemy.testBurnSkill);
//        skillPool.add(SkillEnemy.testFireSkill);

        maxSkillCharges = 2;

        skillCharges = maxSkillCharges;
    }

    public int useSkill(ArrayList<Skill> skillPool) {

        // create random selector and pick  from skillpool array
        int index = rand.nextInt(skillPool.size());

        Skill pickedSkill = skillPool.get(index);

        int damage = pickedSkill.damage();
        System.out.println("Enemy Damage: " + damage);
        if (pickedSkill.condition1 != null) {
            pickedSkill.addConditionTarget(pickedSkill.condition1);
        }
        if (pickedSkill.condition2 != null) {
            pickedSkill.addConditionTarget(pickedSkill.condition2);
        }

        pickedSkillString = pickedSkill.useText();

        return damage;
    }

    public void setBaseStatsEnemy() {

        double a;
        double b;
        int playerLevel = GameLogic.act;

        //this if else chain will set playerLevel randomyl based on act, utilizing DnD Levels of play
        if (playerLevel == 4) {
            playerLevel = (int) (Math.random() * (20 - 17)) + 17;   // 19-17 (max-min) //20 WILL BE FOR BOSS
        } else if (playerLevel == 3) {
            playerLevel = (int) (Math.random() * (17 - 11)) + 11;   // 16-11
        } else if (playerLevel == 2) {
            playerLevel = (int) (Math.random() * (11 - 5)) + 5;     // 10-5
        } else {
            playerLevel = (int) (Math.random() * (5 - 1)) + 1;      // 5-1
        }

        //CR = challenge rating
        double CRmax, CRmin, CRboss;

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

        System.out.println("min max boss\n" + CRmin + " " + CRmax + " " + CRboss);

    }

    @Override
    public int attack() {
        int damage = 0;
        if (skillCharges > 0) {
            damage = useSkill(skillPool);
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
