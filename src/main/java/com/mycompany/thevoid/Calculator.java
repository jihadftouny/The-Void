/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.HashMap;
import java.util.Map;

/**
 *
 * @author jihad
 */
public class Calculator {
    
    
    
    public static void setFullName(String name) {

        int randomSelector;
        int mapKey;

        // String is the name, Integer is the percentage
        Map<Integer, String> firstName = new HashMap<Integer, String>();
        Map<Integer, String> middleName = new HashMap<Integer, String>();
        Map<Integer, String> lastName = new HashMap<Integer, String>();

        //the following if else chain will set the HashMap tables to the creature type acquired from the object creation in GameLogic's Array of enemies
        if ("Beast".equals(name)) {
            //STATS mods
            firstName.put(20, "Feral"); // add dmg
            firstName.put(40, "Aerobicized"); // add hp
            firstName.put(60, "Plated"); // add AC

            firstName.put(70, "Bestial"); // add dmg + hp
            firstName.put(80, "Unbreakable"); // add hp + AC
            firstName.put(90, "Cunning"); // add AC + dmg

            firstName.put(96, "Giant"); // add dmg + hp + AC
            firstName.put(99, "Monstrous"); // add dmg + hp + AC A LOT
            firstName.put(100, "Mutated"); // immunity to some elements, equivalent to UNDEAD

            // // //
            middleName.put(20, "Cryo"); // Ice
            middleName.put(40, "Fiery"); // Fire
            middleName.put(60, "Electrified"); // Electro
            middleName.put(80, "Venomous"); // Poison
            middleName.put(100, "Psychogenic"); // Psychic

            //from here on there must be an if else chain for each act's monsters
            lastName.put(20, "Rat");
            lastName.put(40, "Dog");
            lastName.put(60, "Lizard");
            lastName.put(80, "Spider");
            lastName.put(100, "Raven");
        }

        randomSelector = (int) (Math.random() * (101 - 1)) + 1; //1-100

        firstName.forEach((k, v) -> {
            if (randomSelector <= k)
            System.out.println(k + ":" + v);

        });

    }

    public static void calcsCR() {

        double a;
        double b;
        int playerLevel;
        playerLevel = (int) (Math.random() * (20 - 17)) + 17;

        double CRmax, CRmin, CRboss;

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

        for (int i = 1; i <= 20; i++) {
            //min
            a = 0.087970550572;
            b = 1.4100213799828;
            CRmin = a * Math.pow(i, b);

            //max
            a = 0.2320721484759;
            b = 1.319592522878;
            CRmax = a * Math.pow(i, b);

            //boss
            a = 0.4294334810279;
            b = 1.165240310288;
            CRboss = a * Math.pow(i, b);
            int randomSelector = (int) (Math.random() * (101 - 1)) + 1; //10 - 5
            System.out.println(randomSelector);
//            System.out.println("min max boss\n" + CRmin + " " + CRmax + " " + CRboss + " at level " + i);
        }
        
        

//        System.out.println("min max boss\n" + CRmin + " " + CRmax + " " + CRboss + " " + playerLevel);

    }

    public static void jooj2() {
        int act = 3;
        int wR = 10; //10 5 2

        for (int i = 0; i < 100; i++) {
            int price = (int) (Math.random() * ((10 * act + act * 5) - (act * 5) + 1) + (act * 5));
            int jooj = (int) (Math.random() * 15) + 10;
            System.out.println(price);
        }
    }

    public static void jooj() {

        int i = 0;
        int avg = 0;
        while (i < 100) {
            int playerXp = 5;
            int xp = (int) (Math.random() * (playerXp / 4 + 2) + 1);
            int stat = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
            System.out.println("stat: " + stat);
            i++;
            avg += stat;
        }
        System.out.println("avg" + (avg / i));
    }

    public static void dmgCalculator() {
        int playerXp = 150;
        int numAtkUpgrades = 2;
        int numDefUpgrades = 2;

        int monsterXp = (int) (Math.random() * (playerXp / 4 + 2) + 1);
        int maxMonsterHp = (int) (Math.random() * playerXp + playerXp / 3 + 30);
        int monsterHp = maxMonsterHp;
        int playerDmgTook = 0;
        System.out.println(maxMonsterHp);

        int turns = 0;
//        do {
//            int attackM = (int) (Math.random() * (playerXp / 4 + 1) + monsterXp / 4 + 3);
//            int defendM = (int) (Math.random() * (playerXp / 4 + 1) + monsterXp / 4 + 3);
//
//            int attackP = (int) (Math.random() * (playerXp / 4 + numAtkUpgrades * 3 + 3) + playerXp / 10 + numAtkUpgrades * 2 + numDefUpgrades + 1);
//            int defendP = (int) (Math.random() * (playerXp / 4 + numDefUpgrades * 3 + 3) + playerXp / 10 + numDefUpgrades * 2 + numAtkUpgrades + 1);
//            //            int dmg = attackP - defendM;
//            //            int dmgTook = attackM - defendP;
//
//            int dmg = (int) (Math.random() * (attackP - defendM));
//            int dmgTook = (int) (Math.random() * (attackM - defendP));
//            //check that dmg isnt negative
//            if (dmgTook < 0) {
//                dmg -= dmgTook / 2; //add some damage if player defend well
//                dmgTook = 0;
//            }
//            if (dmg < 0) {
//                dmg = 0;
//            }
//
//            //deal damage
//            monsterHp -= dmg;
//            playerDmgTook += dmgTook;
//            //print battle info
//            System.out.println("You dealt " + dmg + " damage to enemy");
//            System.out.println("Enemy dealt " + dmgTook + " damage to you.");
//            turns++;
//        } while (monsterHp > 0);
        System.out.println("DmgTook: " + playerDmgTook);
        System.out.println("Turns: " + turns);
        int i = 0;
        while (i < 10) {
            int Status = 10 + (int) (Math.random() * (playerXp / 4) + monsterXp / 4);
            System.out.println(Status);
            i++;
        }
    }
}
