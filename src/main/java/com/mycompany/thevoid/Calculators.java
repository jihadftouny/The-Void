/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public class Calculators {

    public static void jooj() {

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
